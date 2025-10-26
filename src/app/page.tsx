'use client';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Download, Loader2, XCircle, Wifi, WifiOff, CheckCircle, X, AlertCircle, Archive, Music } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { io, Socket } from 'socket.io-client';
import CustomVideoPlayer from '@/components/x';
import MediaPreview from '@/components/MediaPreview';
import DownloadActions from '@/components/DownloadActions';
import DownloadProgress from '@/components/DowloadProgress';


export default function Root() {
  const [url, setUrl] = useState('');
  const [platform, setPlatform] = useState('');
  const [preview, setPreview] = useState<any>(null);
  const [qualities, setQualities] = useState<string[]>([]);
  const [quality, setQuality] = useState('highest');
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [status, setStatus] = useState<any>(null);
  const [connected, setConnected] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');
  const [showContent, setShowContent] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [downloadingMetadata, setDownloadingMetadata] = useState(false);
  const [downloadType, setDownloadType] = useState<'video' | 'audio' | null>(null);

  const socketRef = useRef<Socket | null>(null);
  const currentId = useRef<string | null>(null);
  const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const BACKEND = useMemo(() => process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:5000', []);

  // Platform detection
  useEffect(() => {
    if (url.includes('youtu')) setPlatform('youtube');
    else if (url.includes('instagram')) setPlatform('instagram');
    else if (url.includes('pinterest')) setPlatform('pinterest');
    else setPlatform('');
  }, [url]);

  // Reset status when URL changes
  useEffect(() => {
    if (status?.status === 'completed' && url !== status?.original_url) {
      setStatus(null);
      setDownloading(false);
      currentId.current = null;
    }
  }, [url, status]);

  // Socket setup
  useEffect(() => {
    const socket = io(BACKEND, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 10,
      timeout: 20000,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      setReconnecting(false);
      if (currentId.current) {
        socket.emit('join', { download_id: currentId.current });
      }
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = setInterval(() => socket.emit('ping'), 15000);
    });

    socket.on('disconnect', () => {
      setConnected(false);
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }
      if (downloading) setReconnecting(true);
    });

    socket.on('download_update', (d: any) => {
      if (d.download_id === currentId.current) {
        setStatus({
          ...d.session,
          original_url: status?.original_url || url,
          download_type: status?.download_type || downloadType || 'video', // 👈 preserve
        });
        if (d.session.status === 'completed' || d.session.status === 'error') {
          setDownloading(false);
        }
      }
    });


    return () => {
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      socket.disconnect();
    };
  }, [BACKEND, downloading, url, status?.original_url]);

  const fetchPreview = useCallback(async () => {
    if (!url.trim()) {
      setShowContent(false);
      setPreview(null);
      return;
    }

    setLoadingPreview(true);
    setError('');
    setShowContent(true);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      const res = await fetch(`${BACKEND}/api/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Preview failed');
      setPreview(data);
      setQualities(data.available_qualities || []);
      setQuality(data.available_qualities?.[0] || 'highest');
      setError('');
    } catch (e: any) {
      setError(e.name === 'AbortError' ? 'Preview timed out. Please try again.' : e.message);
      setPreview(null);
    } finally {
      setLoadingPreview(false);
    }
  }, [url, BACKEND]);

  useEffect(() => {
    const timeout = setTimeout(fetchPreview, 600);
    return () => clearTimeout(timeout);
  }, [url, fetchPreview]);

  const startDownload = async (type: 'video' | 'audio' = 'video') => {
    if (!url) return setError('Enter a URL first');
    if (!connected) return setError('Not connected to server');

    setError('');
    setDownloading(true);
    setDownloadType(type);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      const endpoint = type === 'audio' ? '/api/download-audio' : '/api/download';
      const res = await fetch(`${BACKEND}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, platform, quality }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start download');

      if (data.status === 'completed' && (data.direct_links || data.download_url)) {
        setStatus({
          status: 'completed',
          progress: 100,
          message: type === 'audio' ? 'Audio ready! 🎵' : 'Ready to download! ✅',
          direct_links: data.direct_links,
          audio_link: data.audio_link,
          download_url: data.download_url,
          downloaded_files: data.downloaded_files,
          platform: data.platform,
          original_url: url,
          download_type: type
        });
        setDownloading(false);
        return;
      }

      currentId.current = data.download_id;
      socketRef.current?.emit('join', { download_id: data.download_id });
      setStatus({
        status: 'queued',
        progress: 0,
        message: type === 'audio' ? 'Extracting audio...' : 'Starting download...',
        original_url: url,
        download_type: type
      });
    } catch (e: any) {
      setError(e.name === 'AbortError' ? 'Request timed out. Please try again.' : e.message);
      setDownloading(false);
      setDownloadType(null);
    }
  };

  const handleDownloadWithMetadata = async () => {
    if (!url || !platform) return setError('Missing URL or platform information');
    setDownloadingMetadata(true);
    setError('');

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 600000);
      const res = await fetch(`${BACKEND}/api/download-with-metadata`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, platform }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to create metadata ZIP');

      const blob = await res.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const contentDisposition = res.headers.get('Content-Disposition');
      let filename = `${platform}_with_metadata.zip`;
      if (contentDisposition) {
        const match = contentDisposition.match(/filename="?([^"]+)"?/);
        if (match) filename = match[1];
      }

      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(downloadUrl);
    } catch (e: any) {
      setError(e.name === 'AbortError' ? 'ZIP creation timed out. Try downloading files individually.' : e.message || 'Failed to download ZIP');
    } finally {
      setDownloadingMetadata(false);
    }
  };

  const handleBrowserDownload = (type?: 'video' | 'audio') => {
    const downloadType = type || status?.download_type || 'video';

    if (downloadType === 'audio' && status?.audio_link) {
      const a = document.createElement('a');
      a.href = `${BACKEND}${status.audio_link.url}`;
      a.download = status.audio_link.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return;
    }

    if (status?.direct_links?.length) {
      const link = status.direct_links[0];
      const a = document.createElement('a');
      a.href = `${BACKEND}/api/proxy-download?url=${encodeURIComponent(link.url)}&filename=${encodeURIComponent(link.filename)}`;
      a.download = link.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return;
    }

    if (!status?.download_url && !status?.downloaded_files?.length) {
      setError('No download URL available');
      return;
    }

    if (status.download_url) {
      const downloadUrl = status.download_url.startsWith('http') ? status.download_url : `${BACKEND}${status.download_url}`;
      window.open(downloadUrl, '_blank');
      return;
    }

    if (status.downloaded_files?.length) {
      const file = status.downloaded_files[0];
      window.open(`${BACKEND}/downloads/${platform}/${encodeURIComponent(file)}`, '_blank');
    }
  };

  const handleMultiDownload = () => {
    if (status?.direct_links?.length) {
      status.direct_links.forEach((link: any, index: number) => {
        setTimeout(() => {
          const a = document.createElement('a');
          a.href = `${BACKEND}/api/proxy-download?url=${encodeURIComponent(link.url)}&filename=${encodeURIComponent(link.filename)}`;
          a.download = link.filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        }, index * 800);
      });
      return;
    }


    if (!status?.downloaded_files?.length) return;
    status.downloaded_files.forEach((file: string, index: number) => {
      setTimeout(() => {
        window.open(`${BACKEND}/downloads/${platform}/${encodeURIComponent(file)}`, '_blank');
      }, index * 800);
    });
  };

  const cancel = () => {
    if (currentId.current && socketRef.current) {
      socketRef.current.emit('cancel_download', { download_id: currentId.current });
      setStatus({ status: 'cancelling', message: 'Cancelling download...' });
    }
  };

  const handleClose = () => {
    setUrl('');
    setPreview(null);
    setShowContent(false);
    setStatus(null);
    setError('');
    setDownloading(false);
    setDownloadType(null);
    currentId.current = null;
  };

  const handleDownloadZip = () => {
    if (!status?.downloaded_files?.length) return;
    const zipUrl = `${BACKEND}/api/download-zip?platform=${platform}&` +
      status.downloaded_files.map(file => `files[]=${encodeURIComponent(file)}`).join('&');
    window.open(zipUrl, '_blank');
  };

  return (
    <div className="min-h-screen bg-zinc-950 relative overflow-hidden">
      <span className='cod'>Codxell</span>

      {/* Connection Status */}
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="fixed top-4 right-4 z-50">
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium backdrop-blur-sm transition-all ${reconnecting ? 'bg-yellow-900/20 text-yellow-400 border border-yellow-800' :
          connected ? 'bg-green-900/20 text-green-400 border border-green-800' :
            'bg-red-900/20 text-red-400 border border-red-800'
          }`}>
          {reconnecting ? <><Loader2 size={14} className="animate-spin" />Reconnecting...</> :
            connected ? <><Wifi size={14} />Connected</> :
              <><WifiOff size={14} />Offline</>}
        </div>
      </motion.div>

      {/* Centered Input */}
      <AnimatePresence>
        {!showContent && (
          <motion.div initial={{ opacity: 1 }} exit={{ opacity: 0, scale: 0.95 }} transition={{ duration: 0.3 }}
            className="fixed inset-0 flex items-center justify-center p-4">
            <div className="w-full max-w-2xl">
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
                <input value={url} onChange={(e) => setUrl(e.target.value)}
                  placeholder="Paste YouTube, Instagram, or Pinterest link..."
                  className="w-full border border-zinc-700 rounded-2xl px-6 py-4 text-base bg-zinc-900/50 backdrop-blur-sm text-white placeholder-zinc-500 focus:ring-2 focus:ring-zinc-600 focus:border-zinc-600 outline-none transition-all shadow-2xl"
                  autoFocus />
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Content View */}
      <AnimatePresence>
        {showContent && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}
            className="min-h-screen flex flex-col md:flex-row">

            {/* Left Side - Content */}
            <motion.div initial={{ x: -100, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ duration: 0.4, ease: 'easeOut' }}
              className="flex-1 p-6 overflow-y-auto">
              <div className="max-w-4xl mx-auto">
                <motion.button initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.2 }}
                  onClick={handleClose}
                  className="mb-6 flex items-center gap-2 px-4 py-2 bg-zinc-800/50 hover:bg-zinc-800 text-zinc-300 rounded-lg transition-colors border border-zinc-700">
                  <X size={18} /><span className="text-sm">Close</span>
                </motion.button>

                <AnimatePresence mode="wait">
                  {loadingPreview ? (
                    <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                      className="flex justify-center items-center p-20 text-zinc-500">
                      <Loader2 className="animate-spin mr-3" size={24} /><span>Loading preview...</span>
                    </motion.div>
                  ) : preview ? (
                    <motion.div key="preview" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
                      className="rounded-2xl overflow-hidden bg-zinc-900 border border-zinc-800 shadow-2xl">

                      {preview.media?.length ? (
                        <MediaPreview media={preview.media} backend={BACKEND} />
                      ) : preview.video_url ? (
                        <CustomVideoPlayer
                          src={`${BACKEND}/api/proxy-video?url=${encodeURIComponent(preview.video_url)}`}
                          poster={preview.thumbnail ? `${BACKEND}/api/proxy-image?url=${encodeURIComponent(preview.thumbnail)}` : undefined}
                        />
                      ) : preview.thumbnail ? (
                        <img
                          src={`${BACKEND}/api/proxy-image?url=${encodeURIComponent(preview.thumbnail)}`}
                          alt={preview.title}
                          className="w-full h-auto object-contain bg-black"
                        />
                      ) : null}

                      <div className="p-6">
                        <h3 className="font-semibold text-white text-xl mb-2">{preview.title || 'Untitled'}</h3>
                        {preview.author && <p className="text-zinc-400 text-sm">By {preview.author}</p>}
                        {preview.ux_tip && <p className="text-zinc-500 text-sm italic mt-3">{preview.ux_tip}</p>}
                      </div>
                    </motion.div>
                  ) : null}
                </AnimatePresence>

                <AnimatePresence>
                  {error && (
                    <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
                      className="mt-4 bg-red-900/20 border border-red-800 p-4 rounded-xl text-red-400 text-sm flex items-start gap-3">
                      <XCircle size={16} className="mt-0.5 flex-shrink-0" /><span>{error}</span>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>

            {/* Right Side - Controls */}
            <motion.div initial={{ x: 100, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ duration: 0.4, ease: 'easeOut' }}
              className="w-full md:w-96 bg-zinc-900 border-l border-zinc-800 p-6 overflow-y-auto flex flex-col">
              <div className="space-y-4 flex-1">
                <div>
                  <label className="text-zinc-400 text-xs mb-2 block">URL</label>
                  <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste link..."
                    className="w-full border border-zinc-700 rounded-lg px-4 py-2.5 text-sm bg-zinc-800 text-white placeholder-zinc-500 focus:ring-2 focus:ring-zinc-600 focus:border-zinc-600 outline-none transition-all" />
                </div>

                {platform && (
                  <div className="flex items-center gap-2">
                    <span className="text-zinc-400 text-xs">Platform:</span>
                    <span className="px-2 py-1 bg-zinc-800 text-zinc-300 text-xs rounded-md border border-zinc-700 capitalize">{platform}</span>
                  </div>
                )}

                {qualities.length > 0 && (
                  <div>
                    <label className="text-zinc-400 text-xs mb-2 block">Quality</label>
                    <div className="flex flex-wrap gap-2">
                      {['1080p', '720p', '480p', '360p', '240p', '144p'].map((q) => {
                        const available = qualities.includes(q);
                        const active = q === quality;
                        return (
                          <button key={q} onClick={() => available && setQuality(q)} disabled={!available}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${!available ? 'bg-zinc-800 text-zinc-600 cursor-not-allowed border border-zinc-700' :
                              active ? 'bg-zinc-700 text-white border border-zinc-600' :
                                'bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 hover:border-zinc-600'
                              }`}>{q}</button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="space-y-3">
                  <DownloadActions
                    status={status}
                    url={url}
                    platform={platform}
                    preview={preview}
                    downloading={downloading}
                    downloadType={downloadType}
                    loadingPreview={loadingPreview}
                    connected={connected}
                    downloadingMetadata={downloadingMetadata}
                    handleBrowserDownload={handleBrowserDownload}
                    handleMultiDownload={handleMultiDownload}
                    handleDownloadZip={handleDownloadZip}
                    handleDownloadWithMetadata={handleDownloadWithMetadata}
                    startDownload={startDownload}
                  />

                </div>

                {preview && (
                  <div className="pt-4 border-t border-zinc-800">
                    <h4 className="text-zinc-400 text-xs mb-2">Download Info</h4>
                    <div className="space-y-2 text-xs text-zinc-500">
                      {preview.duration && (
                        <div className="flex justify-between">
                          <span>Duration:</span>
                          <span className="text-zinc-300">{Math.floor(preview.duration / 60)}:{String(preview.duration % 60).padStart(2, '0')}</span>
                        </div>
                      )}
                      {preview.media?.length && (
                        <div className="flex justify-between">
                          <span>Media Files:</span>
                          <span className="text-zinc-300">{preview.media.length}</span>
                        </div>
                      )}
                      {qualities.length > 0 && (
                        <div className="flex justify-between">
                          <span>Selected Quality:</span>
                          <span className="text-zinc-300">{quality}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <DownloadProgress
                status={status}
                reconnecting={reconnecting}
                cancel={cancel}
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}