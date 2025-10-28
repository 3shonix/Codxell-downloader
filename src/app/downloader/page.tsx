'use client';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import SmartTextarea from '@/components/TextArea';
import {
  Download,
  Loader2,
  XCircle,
  Wifi,
  WifiOff,
  CheckCircle,
  AlertCircle,
  Archive,
  Music,
} from 'lucide-react';
import { AnimatePresence } from 'framer-motion';
import { io } from 'socket.io-client';
import CustomVideoPlayer from '@/components/x';
import MediaPreview from '@/components/MediaPreview';
import DownloadActions from '@/components/DownloadActions';
import DownloadProgress from '@/components/DowloadProgress';
import { Button } from '@/components/ui/button';

// ---- Types ----
interface MediaItem {
  type: 'image' | 'video';
  url: string;
  thumbnail?: string;
  caption?: string;
}

interface PreviewData {
  title?: string;
  author?: string;
  duration?: number; // seconds
  video_url?: string;
  thumbnail?: string;
  platform?: string;
  ux_tip?: string;
  media?: MediaItem[];
  available_qualities?: string[];
}

interface DownloadLink {
  url: string;
  filename: string;
}

interface AudioLink {
  url: string;
  filename: string;
}

interface DownloadStatus {
  status?: 'queued' | 'downloading' | 'completed' | 'error' | 'cancelling';
  progress?: number;
  message?: string;
  direct_links?: DownloadLink[];
  audio_link?: AudioLink;
  download_url?: string;
  downloaded_files?: string[];
  platform?: string;
  original_url?: string;
  download_type?: 'video' | 'audio';
  error?: string;
}

// ---- Component ----
export default function DownloaderPage() {
  type DownloadType = 'video' | 'audio' | null;

  // state
  const [url, setUrl] = useState<string>('');
  const [platform, setPlatform] = useState<string>('');
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [qualities, setQualities] = useState<string[]>([]);
  const [quality, setQuality] = useState<string>('');
  const [loadingPreview, setLoadingPreview] = useState<boolean>(false);
  const [status, setStatus] = useState<DownloadStatus | null>(null);
  const [connected, setConnected] = useState<boolean>(false);
  const [downloading, setDownloading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [reconnecting, setReconnecting] = useState<boolean>(false);
  const [downloadingMetadata, setDownloadingMetadata] = useState<boolean>(false);
  const [downloadType, setDownloadType] = useState<DownloadType>(null);

  // refs
  const socketRef = useRef<any>(null);
  const currentId = useRef<string | null>(null);
  const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const BACKEND = useMemo(() => process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:5000', []);

  // -------------------------
  // Helper / small utilities
  // -------------------------
  const formatDuration = (seconds?: number) => {
    if (!seconds && seconds !== 0) return null;
    const s = Math.floor(seconds);
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, '0')}`;
  };

  // -------------------------
  // Reset helpers
  // -------------------------
  const resetContentView = useCallback(() => {
    setPreview(null);
    setStatus(null);
    setError('');
    setLoadingPreview(false);
    setPlatform('');
    setQualities([]);
    setQuality('');
    setDownloading(false);
    setDownloadType(null);
    setDownloadingMetadata(false);
    setReconnecting(false);

    if (currentId.current && socketRef.current) {
      try {
        socketRef.current.emit('cancel_download', { download_id: currentId.current });
      } catch (e) {
        // ignore
      }
      currentId.current = null;
    }
  }, []);

  useEffect(() => {
    if (!url) resetContentView();
  }, [url, resetContentView]);

  // -------------------------
  // Platform detection
  // -------------------------
  useEffect(() => {
    const u = url.toLowerCase();
    if (u.includes('youtu')) setPlatform('youtube');
    else if (u.includes('instagram')) setPlatform('instagram');
    else if (u.includes('pinterest')) setPlatform('pinterest');
    else setPlatform('');
  }, [url]);

  // -------------------------
  // Socket setup (lean)
  // -------------------------
  useEffect(() => {
    const socket = io(BACKEND, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      timeout: 20000,
    });
    socketRef.current = socket;

    const startPing = () => {
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = setInterval(() => {
        try {
          socket.emit('ping');
        } catch {
          // no-op
        }
      }, 15000);
    };

    socket.on('connect', () => {
      setConnected(true);
      setReconnecting(false);
      if (currentId.current) socket.emit('join', { download_id: currentId.current });
      startPing();
    });

    socket.on('disconnect', () => {
      setConnected(false);
      if (downloading) setReconnecting(true);
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }
    });

    socket.on('connect_error', () => {
      // keep UI simple: show disconnected state
    });

    socket.on('download_update', (d: any) => {
      // ensure updates only for current download
      if (!d) return;
      try {
        if (d.download_id === currentId.current && d.session) {
          setStatus((prev) => ({
            ...d.session,
            original_url: prev?.original_url || url,
            download_type: prev?.download_type || downloadType || 'video',
          }));
          if (d.session.status === 'completed' || d.session.status === 'error') {
            setDownloading(false);
            currentId.current = d.session.download_id || null;
          }
        }
      } catch (err) {
        // ignore
      }
    });

    return () => {
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }
      try {
        socket.disconnect();
      } catch {
        // ignore
      }
    };
  }, [BACKEND, downloading, url, downloadType]);

  // -------------------------
  // Fetch preview (debounced)
  // -------------------------
  const fetchPreview = useCallback(async () => {
    if (!url.trim()) {
      setPreview(null);
      return;
    }
    setLoadingPreview(true);
    setError('');
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const res = await fetch(`${BACKEND}/api/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Preview failed');
      setPreview(data);
      setQualities(data.available_qualities || []);
      setQuality(data.available_qualities?.[0] || 'highest');
      setError('');
    } catch (e: any) {
      setPreview(null);
      setError(e.name === 'AbortError' ? 'Preview timed out. Try again.' : e.message || 'Preview failed');
    } finally {
      setLoadingPreview(false);
    }
  }, [url, BACKEND]);

  useEffect(() => {
    const t = setTimeout(fetchPreview, 600);
    return () => clearTimeout(t);
  }, [url, fetchPreview]);

  // -------------------------
  // Download start / actions
  // -------------------------
  const startDownload = async (type: 'video' | 'audio' = 'video') => {
    if (!url) return setError('Enter a URL first');
    if (!connected) return setError('Not connected to server');

    if (type === 'video' && qualities.length > 0 && (!quality || quality === 'none')) {
      setError('Select a quality before downloading');
      return;
    }

    setError('');
    setDownloading(true);
    setDownloadType(type);

    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 10000);
      const endpoint = type === 'audio' ? '/api/download-audio' : '/api/download';
      const res = await fetch(`${BACKEND}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, platform, quality }),
        signal: controller.signal,
      });
      clearTimeout(t);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start download');

      if (data.status === 'completed' && (data.direct_links || data.download_url)) {
        setStatus({
          status: 'completed',
          progress: 100,
          message: type === 'audio' ? 'Audio ready' : 'Ready to download',
          direct_links: data.direct_links,
          audio_link: data.audio_link,
          download_url: data.download_url,
          downloaded_files: data.downloaded_files,
          platform: data.platform,
          original_url: url,
          download_type: type,
        });
        setDownloading(false);
        currentId.current = null;
        return;
      }

      currentId.current = data.download_id;
      socketRef.current?.emit('join', { download_id: data.download_id });
      setStatus({
        status: 'queued',
        progress: 0,
        message: type === 'audio' ? 'Extracting audio...' : 'Preparing download...',
        original_url: url,
        download_type: type,
      });
    } catch (e: any) {
      setError(e.name === 'AbortError' ? 'Request timed out. Try again.' : e.message || 'Failed to start download');
      setDownloading(false);
      setDownloadType(null);
    }
  };

  const handleDownloadWithMetadata = async () => {
    if (!url || !platform) return setError('Missing URL or platform');
    setDownloadingMetadata(true);
    setError('');
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 600000);
      const res = await fetch(`${BACKEND}/api/download-with-metadata`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, platform }),
        signal: controller.signal,
      });
      clearTimeout(t);
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      const blob = await res.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const disposition = res.headers.get('Content-Disposition');
      let filename = `${platform}_with_metadata.zip`;
      if (disposition) {
        const match = disposition.match(/filename="?([^"]+)"?/);
        if (match) filename = match[1];
      }
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(downloadUrl);
    } catch (e: any) {
      setError(e.name === 'AbortError' ? 'ZIP creation timed out.' : e.message || 'Failed to create ZIP');
    } finally {
      setDownloadingMetadata(false);
    }
  };

  const handleBrowserDownload = (type?: 'video' | 'audio') => {
    const dt = type || status?.download_type || 'video';
    // audio direct link
    if (dt === 'audio' && status?.audio_link) {
      const a = document.createElement('a');
      a.href = `${BACKEND}${status.audio_link.url}`;
      a.download = status.audio_link.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      return;
    }

    if (status?.direct_links?.length) {
      const link = status.direct_links[0];
      const a = document.createElement('a');
      a.href = `${BACKEND}/api/proxy-download?url=${encodeURIComponent(link.url)}&filename=${encodeURIComponent(link.filename)}`;
      a.download = link.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      return;
    }

    if (!status?.download_url && !status?.downloaded_files?.length) {
      setError('No download available');
      return;
    }

    if (status.download_url) {
      const dl = status.download_url.startsWith('http') ? status.download_url : `${BACKEND}${status.download_url}`;
      window.open(dl, '_blank');
      return;
    }

    if (status.downloaded_files?.length) {
      const file = status.downloaded_files[0];
      window.open(`${BACKEND}/downloads/${platform}/${encodeURIComponent(file)}`, '_blank');
    }
  };

  const handleMultiDownload = () => {
    if (status?.direct_links?.length) {
      status.direct_links.forEach((link, idx) => {
        setTimeout(() => {
          const a = document.createElement('a');
          a.href = `${BACKEND}/api/proxy-download?url=${encodeURIComponent(link.url)}&filename=${encodeURIComponent(link.filename)}`;
          a.download = link.filename;
          document.body.appendChild(a);
          a.click();
          a.remove();
        }, idx * 700);
      });
      return;
    }

    if (!status?.downloaded_files?.length) return;
    status.downloaded_files.forEach((file, idx) => {
      setTimeout(() => {
        window.open(`${BACKEND}/downloads/${platform}/${encodeURIComponent(file)}`, '_blank');
      }, idx * 700);
    });
  };

  const cancel = () => {
    if (currentId.current && socketRef.current) {
      try {
        socketRef.current.emit('cancel_download', { download_id: currentId.current });
      } catch { }
      setStatus({ status: 'cancelling', message: 'Cancelling download...' });
    }
  };

  const handleDownloadZip = () => {
    if (!status?.downloaded_files?.length) return;
    const zipUrl = `${BACKEND}/api/download-zip?platform=${platform}&` +
      status.downloaded_files.map(f => `files[]=${encodeURIComponent(f)}`).join('&');
    window.open(zipUrl, '_blank');
  };

  // -------------------------
  // Button state helper
  // -------------------------
  const getButtonState = () => {
    if (downloading) return 'processing';
    if (loadingPreview) return 'loading';
    if (!connected) return 'disconnected';
    if (!platform) return 'no-platform';
    return 'ready';
  };
  const buttonState = getButtonState();

  // -------------------------
  // Render
  // -------------------------
  return (
    <div className="h-screen bg-zinc-950 relative overflow-hidden">
      {/* Connection Status (compact) */}
      <div className="fixed top-4 right-4 z-50">
        <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium backdrop-blur-sm transition-all ${reconnecting ? 'bg-yellow-900/20 text-yellow-400 border border-yellow-800' : connected ? 'bg-green-900/20 text-green-400 border border-green-800' : 'bg-red-900/20 text-red-400 border border-red-800'}`}>
          {reconnecting ? <><Loader2 size={14} className="animate-spin" />Reconnecting...</> : connected ? <><Wifi size={14} /></> : <><WifiOff size={14} /></>}
        </div>
      </div>

      <AnimatePresence>
        {!url ? (
          <div className="fixed inset-0 flex items-center justify-center">
            <div className="w-full max-w-3xl px-4 sm:px-6 text-center">
              <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold text-white mb-4">Media Downloader</h1>
              <p className="text-zinc-400 text-base sm:text-lg md:text-xl max-w-2xl mx-auto leading-relaxed">
                Download high-quality videos, images, and audio from YouTube, Instagram, and Pinterest with metadata preservation.
              </p>

              <div className="mt-8 relative">
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="Paste your YouTube, Instagram, or Pinterest link here..."
                  className="w-full border border-zinc-700 rounded-xl px-4 py-4 text-base bg-zinc-900/80 text-white placeholder-zinc-500 focus:ring-2 focus:ring-blue-500 outline-none transition-shadow"
                />
              </div>

              <div className="mt-6 flex flex-wrap justify-center gap-3">
                <Button className="px-4 py-2 text-sm bg-red-900/20 text-red-400 border border-red-800/50">YouTube</Button>
                <Button className="px-4 py-2 text-sm bg-pink-900/20 text-pink-400 border border-pink-800/50">Instagram</Button>
                <Button className="px-4 py-2 text-sm bg-red-900/20 text-red-400 border border-red-800/50">Pinterest</Button>
              </div>
            </div>
          </div>
        ) : null}
      </AnimatePresence>

      {/* Main Content when url present */}
      <div className={`h-full ${url ? 'pt-8' : ''} px-4 sm:px-6 pb-8`}>
        {url && (
          <div className="h-full flex flex-col lg:flex-row gap-4 sm:gap-6">
            {/* Left: Preview */}
            <div className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden shadow-2xl">
              <div className="h-full flex flex-col">
                <div className="flex-1 overflow-auto">
                  {/* Loading / Preview */}
                  {loadingPreview ? (
                    <div className="flex items-center justify-center h-60 text-zinc-400">
                      <Loader2 className="animate-spin mr-3" size={24} />
                      Loading preview...
                    </div>
                  ) : preview ? (
                    <div className="flex flex-col">
                      {preview.media?.length ? (
                        <MediaPreview media={preview.media} backend={BACKEND} />
                      ) : preview.video_url ? (
                        <CustomVideoPlayer
                          src={`${BACKEND}/api/proxy-video?url=${encodeURIComponent(preview.video_url)}`}
                          poster={preview.thumbnail ? `${BACKEND}/api/proxy-image?url=${encodeURIComponent(preview.thumbnail)}` : undefined}
                        />
                      ) : preview.thumbnail ? (
                        <img src={`${BACKEND}/api/proxy-image?url=${encodeURIComponent(preview.thumbnail)}`} alt={preview.title} className="w-full object-contain max-h-[300px] bg-black" />
                      ) : (
                        <div className="h-60 flex items-center justify-center text-zinc-500">No preview available</div>
                      )}

                      <div className="p-6">
                        <h3 className="font-semibold text-xl text-white mb-2">{preview.title || 'Untitled'}</h3>
                        {preview.author && <p className="text-zinc-400 text-sm">By {preview.author}</p>}
                        {preview.ux_tip && <p className="text-zinc-500 text-sm italic mt-3">{preview.ux_tip}</p>}
                      </div>
                    </div>
                  ) : (
                    <div className="h-60 flex items-center justify-center text-zinc-500">Paste a link to see preview</div>
                  )}
                </div>
              </div>
            </div>

            {/* Right: Controls */}
            <div className="w-full lg:w-96 bg-zinc-900 border border-zinc-800 rounded-xl p-4 sm:p-6 flex flex-col">
              <div className="space-y-4 flex-1 overflow-auto">
                {/* URL box */}
                <div>
                  <label className="text-zinc-400 text-xs mb-2 block flex items-center gap-2">
                    <span>URL</span>
                    {url && (
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${platform === 'youtube' ? 'bg-red-900/20 text-red-400' : platform === 'instagram' ? 'bg-pink-900/20 text-pink-400' : platform === 'pinterest' ? 'bg-red-900/20 text-red-400' : 'bg-zinc-900/20 text-zinc-400'}`}>
                        {platform || 'Unknown'}
                      </span>
                    )}
                  </label>

                  <SmartTextarea
                    url={url}
                    setUrl={setUrl}
                    loadingPreview={loadingPreview}
                    platform={platform}
                    fetchPreview={fetchPreview}
                    startDownload={startDownload}
                  />


                  {url && !platform && (
                    <p className="text-yellow-400 text-xs mt-1 flex items-center gap-1">
                      <AlertCircle size={12} />
                      Unsupported URL format. Use YouTube, Instagram or Pinterest.
                    </p>
                  )}
                  {/* {url && platform && (
                    <p className="text-green-400 text-xs mt-1 flex items-center gap-1">
                      <CheckCircle size={12} />
                      {platform.charAt(0).toUpperCase() + platform.slice(1)} URL detected
                    </p>
                  )} */}
                </div>

                {/* Qualities (compact) */}
                {qualities.length > 0 && (
                  <div>
                    <label className="text-zinc-300 text-xs font-medium mb-2 block">Quality</label>
                    <div className="grid grid-cols-3 gap-2">
                      {['1080p', '720p', '480p', '360p', '240p', '144p'].map((label) => {
                        const available = qualities.includes(label);
                        const active = label === quality;
                        return (
                          <Button
                            key={label}
                            size="sm"
                            disabled={!available}
                            onClick={() => available && setQuality(label)}
                            className={`${!available ? 'bg-zinc-800/30 text-zinc-600 cursor-not-allowed border border-zinc-800' : active ? 'bg-blue-600 text-white border border-blue-500 shadow-md' : 'bg-zinc-800 text-zinc-300 border border-zinc-700 hover:bg-zinc-750'} px-3 py-2.5 rounded-lg text-xs`}
                          >
                            {label}
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Actions (DownloadActions is intact) */}
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

                {/* Error / Info */}
                <AnimatePresence>
                  {error && (
                    <div className="mt-2 bg-red-900/20 border border-red-800 p-3 rounded-xl text-red-400 text-sm flex items-start gap-3">
                      <XCircle size={16} className="mt-0.5 flex-shrink-0" />
                      <span>{error}</span>
                    </div>
                  )}
                </AnimatePresence>

                {/* Preview Info */}
                {preview && (
                  <div className="pt-2 border-t border-zinc-800">
                    <h4 className="text-zinc-400 text-xs mb-2">Download Info</h4>
                    <div className="space-y-2 text-xs text-zinc-500">
                      {preview.duration !== undefined && (
                        <div className="flex justify-between">
                          <span>Duration:</span>
                          <span className="text-zinc-300">{formatDuration(preview.duration)}</span>
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

              {/* Progress (compact) */}
              <div className="mt-4">
                <DownloadProgress
                  status={status}
                  reconnecting={reconnecting}
                  cancel={cancel}
                  handleBrowserDownload={handleBrowserDownload}
                  handleMultiDownload={handleMultiDownload}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}