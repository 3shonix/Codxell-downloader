'use client';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Download, Loader2, XCircle, Wifi, WifiOff, CheckCircle, X, AlertCircle, Archive, Music } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { io, Socket } from 'socket.io-client';
import CustomVideoPlayer from '@/components/x';
import MediaPreview from '@/components/MediaPreview';
import DownloadActions from '@/components/DownloadActions';
import DownloadProgress from '@/components/DowloadProgress';
// 🧩 Interfaces
interface MediaItem {
  type: "image" | "video";
  url: string;
  thumbnail?: string;
  caption?: string;
}

interface PreviewData {
  title?: string;
  author?: string;
  duration?: number;
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
  status?: "queued" | "downloading" | "completed" | "error" | "cancelling";
  progress?: number;
  message?: string;
  direct_links?: DownloadLink[];
  audio_link?: AudioLink;
  download_url?: string;
  downloaded_files?: string[];
  platform?: string;
  original_url?: string;
  download_type?: "video" | "audio";
}

export default function Root() {
  type DownloadType = "video" | "audio" | null;

  // ⚙️ Typed useState Hooks
  const [url, setUrl] = useState<string>('');
  const [platform, setPlatform] = useState<string>('');
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [qualities, setQualities] = useState<string[]>([]);
  const [quality, setQuality] = useState<string>('highest');
  const [loadingPreview, setLoadingPreview] = useState<boolean>(false);
  const [status, setStatus] = useState<DownloadStatus | null>(null);
  const [connected, setConnected] = useState<boolean>(false);
  const [downloading, setDownloading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [reconnecting, setReconnecting] = useState<boolean>(false);
  const [downloadingMetadata, setDownloadingMetadata] = useState<boolean>(false);
  const [downloadType, setDownloadType] = useState<DownloadType>(null);

  const socketRef = useRef<any>(null);
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

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape to clear URL
      if (e.key === 'Escape' && url) {
        e.preventDefault();
        setUrl('');
        setPreview(null);
        setStatus(null);
        setError('');
      }
      // Ctrl/Cmd + K to focus URL input
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        const input = document.querySelector('input[placeholder*="link"]') as HTMLInputElement;
        input?.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
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

    socketRef.current = socket as any;

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

    socket.on('download_update', (d) => {
      if (d.download_id === currentId.current) {
        setStatus({
          ...d.session,
          original_url: status?.original_url || url,
          download_type: status?.download_type || downloadType || 'video',
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
      setPreview(null);
      return;
    }

    setLoadingPreview(true);
    setError('');

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
          message: type === 'audio' ? 'Audio ready' : 'Ready to download',
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
      status.direct_links.forEach((link, index) => {
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
    status.downloaded_files.forEach((file, index) => {
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

  const handleDownloadZip = () => {
    if (!status?.downloaded_files?.length) return;
    const zipUrl = `${BACKEND}/api/download-zip?platform=${platform}&` +
      status.downloaded_files.map(file => `files[]=${encodeURIComponent(file)}`).join('&');
    window.open(zipUrl, '_blank');
  };

  return (
    <div className="h-screen bg-zinc-950 relative overflow-hidden">
      {/* Connection Status */}
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="fixed top-4 right-4 z-50">
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium backdrop-blur-sm transition-all ${reconnecting ? 'bg-yellow-900/20 text-yellow-400 border border-yellow-800' :
          connected ? 'bg-green-900/20 text-green-400 border border-green-800' :
            'bg-red-900/20 text-red-400 border border-red-800'
          }`}>
          {reconnecting ? <><Loader2 size={14} className="animate-spin" />Reconnecting...</> :
            connected ? <><Wifi size={14} /></> :
              <><WifiOff size={14} /></>}
        </div>
      </motion.div>

      {/* Enhanced Landing Experience */}
      <AnimatePresence>
        {!url && (
          <motion.div
            initial={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.3 }}
            className="fixed inset-0 flex items-center justify-center"
          >
            <div className="w-full max-w-3xl px-4 sm:px-6">
              {/* Hero Section */}
              <motion.div
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1, duration: 0.6 }}
                className="text-center mb-8"
              >
                <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold text-white mb-4">
                  Media Downloader
                </h1>
                <p className="text-zinc-400 text-base sm:text-lg md:text-xl max-w-2xl mx-auto leading-relaxed">
                  Download high-quality videos, images, and audio from YouTube, Instagram, and Pinterest with metadata preservation.
                </p>
              </motion.div>

              {/* Enhanced Input */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3, duration: 0.5 }}
                className="relative"
              >
                <div className="relative">
                  <input
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="Paste your YouTube, Instagram, or Pinterest link here..."
                    className="w-full border border-zinc-700 rounded-xl sm:rounded-2xl px-4 sm:px-6 py-4 sm:py-5 text-base sm:text-lg bg-zinc-900/80 backdrop-blur-sm text-white placeholder-zinc-500 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all shadow-2xl hover:border-zinc-600"
                    autoFocus
                    aria-label="Media URL input"
                    aria-describedby="url-help"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && url.trim()) {
                        fetchPreview();
                      }
                    }}
                  />
                  {/* Input Icon */}
                  <div className="absolute right-4 top-1/2 transform -translate-y-1/2 text-zinc-500">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                    </svg>
                  </div>
                </div>

                {/* Quick Actions */}
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.5, duration: 0.4 }}
                  className="mt-6 flex flex-wrap justify-center gap-3"
                >
                  <button
                    onClick={() => setUrl('https://www.youtube.com/watch?v=')}
                    className="px-4 py-2 bg-red-900/20 hover:bg-red-900/30 text-red-400 rounded-lg text-sm font-medium transition-all border border-red-800/50 hover:border-red-700/50"
                  >
                    YouTube
                  </button>
                  <button
                    onClick={() => setUrl('https://www.instagram.com/p/')}
                    className="px-4 py-2 bg-pink-900/20 hover:bg-pink-900/30 text-pink-400 rounded-lg text-sm font-medium transition-all border border-pink-800/50 hover:border-pink-700/50"
                  >
                    Instagram
                  </button>
                  <button
                    onClick={() => setUrl('https://www.pinterest.com/pin/')}
                    className="px-4 py-2 bg-red-900/20 hover:bg-red-900/30 text-red-400 rounded-lg text-sm font-medium transition-all border border-red-800/50 hover:border-red-700/50"
                  >
                    Pinterest
                  </button>
                </motion.div>

                {/* Features */}
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.7, duration: 0.5 }}
                  className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4 text-center"
                >
                  <div className="p-4 bg-zinc-900/50 rounded-xl border border-zinc-800">
                    <div className="text-lg mb-2 font-semibold text-blue-400">HD</div>
                    <h3 className="text-white font-medium mb-1">High Quality</h3>
                    <p className="text-zinc-400 text-sm">Download in original quality up to 4K</p>
                  </div>
                  <div className="p-4 bg-zinc-900/50 rounded-xl border border-zinc-800">
                    <div className="text-lg mb-2 font-semibold text-green-400">Fast</div>
                    <h3 className="text-white font-medium mb-1">Fast Processing</h3>
                    <p className="text-zinc-400 text-sm">Quick downloads with progress tracking</p>
                  </div>
                  <div className="p-4 bg-zinc-900/50 rounded-xl border border-zinc-800">
                    <div className="text-lg mb-2 font-semibold text-purple-400">Metadata</div>
                    <h3 className="text-white font-medium mb-1">Metadata Included</h3>
                    <p className="text-zinc-400 text-sm">Preserve titles, descriptions & more</p>
                  </div>
                </motion.div>

                {/* Keyboard Shortcuts Help */}
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.9, duration: 0.5 }}
                  className="mt-6 p-4 bg-zinc-900/30 rounded-xl border border-zinc-800"
                >
                  <h4 className="text-zinc-300 font-medium text-sm mb-2">
                    Keyboard Shortcuts
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs text-zinc-500">
                    <div className="flex items-center gap-2">
                      <kbd className="px-2 py-1 bg-zinc-800 rounded text-zinc-300">Ctrl+K</kbd>
                      <span>Focus input</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <kbd className="px-2 py-1 bg-zinc-800 rounded text-zinc-300">Ctrl+Enter</kbd>
                      <span>Start download</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <kbd className="px-2 py-1 bg-zinc-800 rounded text-zinc-300">Esc</kbd>
                      <span>Clear & reset</span>
                    </div>
                  </div>
                </motion.div>
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Content View */}
      <AnimatePresence>
        {url && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="h-screen flex flex-col lg:flex-row items-stretch px-4 sm:px-6 py-4 sm:py-8 gap-4 sm:gap-6"
          >
            {/* Left Side - Content */}
            <motion.div
              initial={{ x: -100, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ duration: 0.4, ease: 'easeOut' }}
              className="flex-1 flex flex-col bg-zinc-900 border border-zinc-800 rounded-xl sm:rounded-2xl overflow-hidden shadow-2xl h-full"
            >
              <div className="flex-1 overflow-hidden p-6 flex flex-col">
                <div className="flex-1 flex flex-col max-w-full w-full">
                  <AnimatePresence mode="wait">
                    {loadingPreview ? (
                      <motion.div
                        key="loading"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="flex justify-center items-center text-zinc-500 py-12"
                      >
                        <Loader2 className="animate-spin mr-3" size={24} />
                        <span>Loading preview...</span>
                      </motion.div>
                    ) : preview ? (
                      <motion.div key="preview" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
                        className="rounded-2xl overflow-hidden bg-zinc-900 border border-zinc-800 shadow-2xl flex-1 flex flex-col">

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
                            className="w-full h-auto object-contain bg-black max-h-[200px]"
                          />
                        ) : null}

                        <div className="p-6">
                          <h3 className={`font-semibold ${preview.title ? 'text-white' : 'text-white/50'} text-xl mb-2`}>{preview.title || 'Untitled'}</h3>
                          {preview.author && <p className="text-zinc-400 text-sm">By {preview.author}</p>}
                          {preview.ux_tip && <p className="text-zinc-500 text-sm italic mt-3">{preview.ux_tip}</p>}
                        </div>
                      </motion.div>
                    ) : null}
                  </AnimatePresence>

                  <AnimatePresence>
                    {error && (
                      <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="mt-4 bg-red-900/20 border border-red-800 p-4 rounded-xl text-red-400 text-sm flex items-start gap-3"
                      >
                        <XCircle size={16} className="mt-0.5 flex-shrink-0" />
                        <span>{error}</span>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </motion.div>

            {/* Right Side - Controls */}
            <motion.div
              initial={{ x: 100, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ duration: 0.4, ease: 'easeOut' }}
              className="w-full lg:w-96 bg-zinc-900 border border-zinc-800 rounded-xl sm:rounded-2xl p-4 sm:p-6 flex flex-col shadow-2xl h-full"
            >
              <div className="space-y-4 flex-1 overflow-hidden">
                <div>
                  <label className="text-zinc-400 text-xs mb-2 block flex items-center gap-2">
                    <span>URL</span>
                    {url && (
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${platform === 'youtube' ? 'bg-red-900/20 text-red-400' :
                          platform === 'instagram' ? 'bg-pink-900/20 text-pink-400' :
                            platform === 'pinterest' ? 'bg-red-900/20 text-red-400' :
                              'bg-zinc-900/20 text-zinc-400'
                        }`}>
                        {platform || 'Unknown'}
                      </span>
                    )}
                  </label>
                  <div className="relative">
                    <input
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      placeholder="Paste your link here..."
                      aria-label="Media URL input"
                      aria-describedby="url-status"
                      className={`w-full border rounded-lg px-4 py-2.5 text-sm bg-zinc-800 text-white placeholder-zinc-500 focus:ring-2 focus:border-zinc-600 outline-none transition-all ${url && !platform ? 'border-yellow-500 focus:ring-yellow-500' :
                          platform ? 'border-green-500 focus:ring-green-500' :
                            'border-zinc-700 focus:ring-zinc-600'
                        }`}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && url.trim()) {
                          fetchPreview();
                        }
                        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && url.trim() && platform) {
                          e.preventDefault();
                          startDownload('video');
                        }
                      }}
                    />
                    {url && (
                      <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                        {loadingPreview ? (
                          <Loader2 size={16} className="animate-spin text-zinc-400" />
                        ) : platform ? (
                          <CheckCircle size={16} className="text-green-400" />
                        ) : (
                          <AlertCircle size={16} className="text-yellow-400" />
                        )}
                      </div>
                    )}
                  </div>
                  {url && !platform && (
                    <p id="url-status" className="text-yellow-400 text-xs mt-1 flex items-center gap-1">
                      <AlertCircle size={12} />
                      Unsupported URL format. Please use YouTube, Instagram, or Pinterest links.
                    </p>
                  )}
                  {url && platform && (
                    <p id="url-status" className="text-green-400 text-xs mt-1 flex items-center gap-1">
                      <CheckCircle size={12} />
                      {platform.charAt(0).toUpperCase() + platform.slice(1)} URL detected
                    </p>
                  )}
                </div>

                {qualities.length > 0 && (
                  <div>
                    <label className="text-zinc-400 text-xs mb-2 block flex items-center gap-2">
                      <span>Quality</span>
                      <span className="text-zinc-500 text-xs">({qualities.length} available)</span>
                    </label>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {[
                        { label: '1080p', res: '1920x1080' },
                        { label: '720p', res: '1280x720' },
                        { label: '480p', res: '854x480' },
                        { label: '360p', res: '640x360' },
                        { label: '240p', res: '426x240' },
                        { label: '144p', res: '256x144' }
                      ].map(({ label, res }) => {
                        const available = qualities.includes(label);
                        const active = label === quality;
                        return (
                          <button
                            key={label}
                            onClick={() => available && setQuality(label)}
                            disabled={!available}
                            className={`px-3 py-2 rounded-lg text-xs font-medium transition-all ${!available
                                ? 'bg-zinc-800/50 text-zinc-600 cursor-not-allowed border border-zinc-800'
                                : active
                                  ? 'bg-blue-600 text-white border border-blue-500 shadow-lg'
                                  : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 hover:border-zinc-600 hover:shadow-md'
                              }`}
                          >
                            {label} <span className="opacity-60 text-[10px] ml-1">{res}</span>
                            {!available && <span className="block text-xs opacity-50">N/A</span>}
                          </button>
                        );
                      })}

                    </div>
                    <p className="text-zinc-500 text-xs mt-2">
                      Higher quality = larger file size
                    </p>
                  </div>
                )}

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

                {preview && (
                  <div className="pt-4 border-t border-zinc-800">
                    <h4 className="text-zinc-400 text-xs mb-2">Download Info</h4>
                    <div className="space-y-2 text-xs text-zinc-500">
                      {preview.duration && (
                        <div className="flex justify-between">
                          <span>Duration:</span>
                          <span className="text-zinc-300">
                            {Math.floor(preview.duration / 60)}:
                            {String(preview.duration % 60).padStart(2, '0')}
                          </span>
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
                handleBrowserDownload={handleBrowserDownload}
                handleMultiDownload={handleMultiDownload}
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}