'use client';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Download, Loader2, XCircle, Wifi, WifiOff, CheckCircle, X, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { io, Socket } from 'socket.io-client';
import CustomVideoPlayer from "@/components/VideoPlayer";

export default function Downloader() {
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
  
  const socketRef = useRef<Socket | null>(null);
  const currentId = useRef<string | null>(null);
  const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  const BACKEND = useMemo(() => process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:5000', []);

  // Platform detection
  useEffect(() => {
    if (url.includes('youtu')) setPlatform('youtube');
    else if (url.includes('instagram')) setPlatform('instagram');
    else if (url.includes('pinterest')) setPlatform('pinterest');
    else setPlatform('');
  }, [url]);

  // Enhanced socket setup with reconnection
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
      console.log('✅ Socket connected');
      setConnected(true);
      setReconnecting(false);
      
      // Rejoin room if there's an active download
      if (currentId.current) {
        socket.emit('join', { download_id: currentId.current });
      }

      // Start heartbeat
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
      }
      pingIntervalRef.current = setInterval(() => {
        socket.emit('ping');
      }, 15000);
    });

    socket.on('disconnect', (reason) => {
      console.warn('⚠️ Socket disconnected:', reason);
      setConnected(false);
      
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }

      // Show reconnecting indicator
      if (downloading) {
        setReconnecting(true);
      }
    });

    socket.on('connect_error', (error) => {
      console.error('Socket connection error:', error);
      setConnected(false);
    });

    socket.on('reconnect_attempt', (attemptNumber) => {
      console.log(`🔄 Reconnection attempt ${attemptNumber}`);
      setReconnecting(true);
    });

    socket.on('reconnect', (attemptNumber) => {
      console.log(`✅ Reconnected after ${attemptNumber} attempts`);
      setReconnecting(false);
    });

    socket.on('reconnect_failed', () => {
      console.error('❌ Reconnection failed');
      setReconnecting(false);
      setError('Connection lost. Please refresh the page.');
    });

    socket.on('download_update', (d: any) => {
      if (d.download_id === currentId.current) {
        setStatus(d.session);
        
        // Auto-clear downloading state on completion
        if (d.session.status === 'completed' || d.session.status === 'error') {
          setDownloading(false);
        }
      }
    });

    socket.on('pong', () => {
      // Heartbeat response
    });

    return () => {
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
      }
      socket.disconnect();
    };
  }, [BACKEND, downloading]);

  // Debounced preview fetch
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
      if (e.name === 'AbortError') {
        setError('Preview timed out. Please try again.');
      } else {
        setError(e.message);
      }
      setPreview(null);
    } finally {
      setLoadingPreview(false);
    }
  }, [url, BACKEND]);

  useEffect(() => {
    const timeout = setTimeout(fetchPreview, 600);
    return () => clearTimeout(timeout);
  }, [url, fetchPreview]);

  // Start download with retry logic
  const startDownload = async () => {
    if (!url) return setError('Enter a URL first');
    if (!connected) return setError('Not connected to server');
    
    setError('');
    setDownloading(true);
    
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const res = await fetch(`${BACKEND}/api/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, platform, quality }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start download');
      
      currentId.current = data.download_id;
      socketRef.current?.emit('join', { download_id: data.download_id });
      setStatus({ 
        status: 'queued', 
        progress: 0, 
        message: 'Starting download...' 
      });
    } catch (e: any) {
      if (e.name === 'AbortError') {
        setError('Request timed out. Please try again.');
      } else {
        setError(e.message);
      }
      setDownloading(false);
    }
  };

  const cancel = () => {
    if (currentId.current && socketRef.current) {
      socketRef.current.emit('cancel_download', { download_id: currentId.current });
      setStatus({ status: 'cancelling', message: 'Cancelling download...' });
    }
  };

  const handleBrowserDownload = () => {
    if (!status?.download_url && !status?.downloaded_files?.length) {
      setError('No download URL available');
      return;
    }

    if (status.download_url) {
      const downloadUrl = status.download_url.startsWith('http')
        ? status.download_url
        : `${BACKEND}${status.download_url}`;
      window.open(downloadUrl, '_blank');
      return;
    }

    if (status.downloaded_files?.length) {
      const file = status.downloaded_files[0];
      const downloadUrl = `${BACKEND}/downloads/${platform}/${encodeURIComponent(file)}`;
      window.open(downloadUrl, '_blank');
    }
  };

  const handleMultiDownload = () => {
    if (!status?.downloaded_files?.length) return;
    status.downloaded_files.forEach((file: string, index: number) => {
      setTimeout(() => {
        const downloadUrl = `${BACKEND}/downloads/${platform}/${encodeURIComponent(file)}`;
        window.open(downloadUrl, '_blank');
      }, index * 800);
    });
  };

  const handleDownloadZip = () => {
    if (!status?.downloaded_files?.length) return;
    const zipUrl = `${BACKEND}/api/download-zip?platform=${platform}&` +
      status.downloaded_files.map((file: string) => `files[]=${encodeURIComponent(file)}`).join('&');
    window.open(zipUrl, '_blank');
  };

  const handleClose = () => {
    setUrl('');
    setPreview(null);
    setShowContent(false);
    setStatus(null);
    setError('');
    setDownloading(false);
    currentId.current = null;
  };

  const MediaPreview = ({ media }: { media: any[] }) => {
    const hasPortraitVideos = media.some(m => m.type === "video");

    return (
      <div className={`grid gap-4 place-items-center ${
        media.length === 1
          ? 'grid-cols-1 max-w-3xl mx-auto'
          : hasPortraitVideos
            ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 auto-rows-max'
            : 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3 auto-rows-max'
      }`}>
        {media.map((item, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3, delay: i * 0.08 }}
            className="relative w-full bg-zinc-900/60 border border-zinc-800 rounded-xl overflow-hidden flex items-center justify-center group"
            style={{ minHeight: item.type === "video" ? '300px' : 'auto' }}
          >
            {item.type === "video" ? (
              <CustomVideoPlayer
                src={`${BACKEND}/api/proxy-video?url=${encodeURIComponent(item.url)}`}
                poster={
                  item.thumbnail
                    ? `${BACKEND}/api/proxy-image?url=${encodeURIComponent(item.thumbnail)}`
                    : undefined
                }
              />
            ) : (
              <img
                src={`${BACKEND}/api/proxy-image?url=${encodeURIComponent(item.url)}`}
                alt={`Media ${i + 1}`}
                className="w-auto h-auto max-w-full max-h-[85vh] rounded-xl object-contain transition-transform duration-300 group-hover:scale-[1.02]"
                loading="lazy"
              />
            )}
          </motion.div>
        ))}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-zinc-950 relative overflow-hidden">
      {/* Connection Status */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="fixed top-4 right-4 z-50"
      >
        <div
          className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium backdrop-blur-sm transition-all ${
            reconnecting
              ? 'bg-yellow-900/20 text-yellow-400 border border-yellow-800'
              : connected
              ? 'bg-green-900/20 text-green-400 border border-green-800'
              : 'bg-red-900/20 text-red-400 border border-red-800'
          }`}
        >
          {reconnecting ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              Reconnecting...
            </>
          ) : connected ? (
            <>
              <Wifi size={14} />
              Connected
            </>
          ) : (
            <>
              <WifiOff size={14} />
              Offline
            </>
          )}
        </div>
      </motion.div>

      {/* Centered Input */}
      <AnimatePresence>
        {!showContent && (
          <motion.div
            initial={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.3 }}
            className="fixed inset-0 flex items-center justify-center p-4"
          >
            <div className="w-full max-w-2xl">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
              >
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="Paste YouTube, Instagram, or Pinterest link..."
                  className="w-full border border-zinc-700 rounded-2xl px-6 py-4 text-base bg-zinc-900/50 backdrop-blur-sm text-white placeholder-zinc-500 focus:ring-2 focus:ring-zinc-600 focus:border-zinc-600 outline-none transition-all shadow-2xl"
                  autoFocus
                />
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Content View */}
      <AnimatePresence>
        {showContent && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="min-h-screen flex"
          >
            {/* Left Side - Content */}
            <motion.div
              initial={{ x: -100, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ duration: 0.4, ease: 'easeOut' }}
              className="flex-1 p-6 overflow-y-auto"
            >
              <div className="max-w-4xl mx-auto">
                {/* Close Button */}
                <motion.button
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ delay: 0.2 }}
                  onClick={handleClose}
                  className="mb-6 flex items-center gap-2 px-4 py-2 bg-zinc-800/50 hover:bg-zinc-800 text-zinc-300 rounded-lg transition-colors border border-zinc-700"
                >
                  <X size={18} />
                  <span className="text-sm">Close</span>
                </motion.button>

                {/* Preview */}
                <AnimatePresence mode="wait">
                  {loadingPreview ? (
                    <motion.div
                      key="loading"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="flex justify-center items-center p-20 text-zinc-500"
                    >
                      <Loader2 className="animate-spin mr-3" size={24} />
                      <span>Loading preview...</span>
                    </motion.div>
                  ) : preview ? (
                    <motion.div
                      key="preview"
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -20 }}
                      className="rounded-2xl overflow-hidden bg-zinc-900 border border-zinc-800 shadow-2xl"
                    >
                      {preview.media?.length ? (
                        <MediaPreview media={preview.media} />
                      ) : preview.video_url ? (
                        <div className="relative w-full max-w-4xl mx-auto">
                          <CustomVideoPlayer
                            src={`${BACKEND}/api/proxy-video?url=${encodeURIComponent(preview.video_url)}`}
                            poster={
                              preview.thumbnail
                                ? `${BACKEND}/api/proxy-image?url=${encodeURIComponent(preview.thumbnail)}`
                                : undefined
                            }
                          />
                        </div>
                      ) : preview.thumbnail ? (
                        <div className="relative w-full max-w-4xl mx-auto">
                          <img
                            src={`${BACKEND}/api/proxy-image?url=${encodeURIComponent(preview.thumbnail)}`}
                            alt={preview.title}
                            className="w-full h-auto rounded-xl object-contain max-h-[85vh]"
                          />
                        </div>
                      ) : null}
                      <div className="p-6">
                        <h3 className="font-semibold text-white text-xl mb-2">{preview.title}</h3>
                        {preview.author && <p className="text-zinc-400 text-sm">By {preview.author}</p>}
                        {preview.ux_tip && <p className="text-zinc-500 text-sm italic mt-3">{preview.ux_tip}</p>}
                      </div>
                    </motion.div>
                  ) : null}
                </AnimatePresence>

                {/* Error */}
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

                {/* Status */}
                <AnimatePresence>
                  {status && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="mt-4 bg-zinc-900 border border-zinc-800 rounded-xl p-6"
                    >
                      <div className="flex items-center gap-3 mb-3">
                        {status.status === 'completed' && <CheckCircle className="text-green-400" size={20} />}
                        {status.status === 'error' && <XCircle className="text-red-400" size={20} />}
                        {['queued', 'downloading', 'processing', 'cancelling'].includes(status.status) && (
                          <Loader2 className="text-zinc-400 animate-spin" size={20} />
                        )}
                        <span className="font-semibold capitalize text-white">{status.status}</span>
                        {reconnecting && (
                          <span className="text-yellow-400 text-xs flex items-center gap-1 ml-auto">
                            <AlertCircle size={14} />
                            Reconnecting...
                          </span>
                        )}
                      </div>
                      <p className="text-zinc-300 text-sm mb-4">{status.message}</p>

                      {status.progress !== undefined && (
                        <div className="mb-4">
                          <div className="h-2 w-full bg-zinc-800 rounded-full overflow-hidden">
                            <motion.div
                              initial={{ width: 0 }}
                              animate={{ width: `${status.progress}%` }}
                              transition={{ duration: 0.2, ease: 'easeOut' }}
                              className="h-2 bg-gradient-to-r from-zinc-600 to-zinc-500 rounded-full"
                            />
                          </div>
                          <div className="text-zinc-400 text-xs mt-2 font-medium">
                            {Math.min(status.progress || 0, 100)}%
                          </div>
                        </div>
                      )}

                      <div className="flex flex-wrap gap-2">
                        {status.status === 'completed' && (
                          <>
                            <button
                              onClick={handleBrowserDownload}
                              className="px-4 py-2 bg-zinc-700 text-white rounded-lg text-sm font-medium hover:bg-zinc-600 transition-all flex items-center gap-2 border border-zinc-600"
                            >
                              <Download size={16} />
                              Download
                            </button>
                            {status.downloaded_files?.length > 1 && (
                              <>
                                <button
                                  onClick={handleMultiDownload}
                                  className="px-4 py-2 bg-zinc-600 text-white rounded-lg text-sm font-medium hover:bg-zinc-500 transition-all flex items-center gap-2 border border-zinc-500"
                                >
                                  <Download size={16} />
                                  Download All ({status.downloaded_files.length})
                                </button>
                                <button
                                  onClick={handleDownloadZip}
                                  className="px-4 py-2 bg-zinc-600 text-white rounded-lg text-sm font-medium hover:bg-zinc-500 transition-all flex items-center gap-2 border border-zinc-500"
                                >
                                  <Download size={16} />
                                  Download ZIP
                                </button>
                              </>
                            )}
                          </>
                        )}
                        {['queued', 'downloading', 'processing'].includes(status.status) && (
                          <button
                            onClick={cancel}
                            className="px-4 py-2 bg-red-800 text-white rounded-lg text-sm font-medium hover:bg-red-700 transition-all border border-red-700"
                          >
                            Cancel
                          </button>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>

            {/* Right Side - Controls */}
            <motion.div
              initial={{ x: 100, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ duration: 0.4, ease: 'easeOut' }}
              className="w-full md:w-96 bg-zinc-900 border-l border-zinc-800 p-6 overflow-y-auto"
            >
              <div className="space-y-4">
                {/* URL Input */}
                <div>
                  <label className="text-zinc-400 text-xs mb-2 block">URL</label>
                  <input
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="Paste link..."
                    className="w-full border border-zinc-700 rounded-lg px-4 py-2.5 text-sm bg-zinc-800 text-white placeholder-zinc-500 focus:ring-2 focus:ring-zinc-600 focus:border-zinc-600 outline-none transition-all"
                  />
                </div>

                {/* Platform Badge */}
                {platform && (
                  <div className="flex items-center gap-2">
                    <span className="text-zinc-400 text-xs">Platform:</span>
                    <span className="px-2 py-1 bg-zinc-800 text-zinc-300 text-xs rounded-md border border-zinc-700 capitalize">
                      {platform}
                    </span>
                  </div>
                )}

                {/* Quality Selection */}
                {qualities.length > 0 && (
                  <div>
                    <label className="text-zinc-400 text-xs mb-2 block">Quality</label>
                    <div className="flex flex-wrap gap-2">
                      {['1080p', '720p', '480p', '360p', '240p', '144p'].map((q) => {
                        const available = qualities.includes(q);
                        const active = q === quality;
                        return (
                          <button
                            key={q}
                            onClick={() => available && setQuality(q)}
                            disabled={!available}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                              !available
                                ? 'bg-zinc-800 text-zinc-600 cursor-not-allowed border border-zinc-700'
                                : active
                                ? 'bg-zinc-700 text-white border border-zinc-600'
                                : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 hover:border-zinc-600'
                            }`}
                          >
                            {q}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Download Button */}
                <button
                  onClick={startDownload}
                  disabled={downloading || !platform || loadingPreview || !connected}
                  className="w-full py-3 bg-zinc-800 text-white text-sm font-semibold rounded-xl hover:bg-zinc-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed border border-zinc-700"
                >
                  {downloading ? (
                    <div className="flex items-center justify-center gap-2">
                      <Loader2 className="animate-spin" size={16} />
                      Downloading...
                    </div>
                  ) : loadingPreview ? (
                    <div className="flex items-center justify-center gap-2">
                      <Loader2 className="animate-spin" size={16} />
                      Loading...
                    </div>
                  ) : !connected ? (
                    <div className="flex items-center justify-center gap-2">
                      <WifiOff size={16} />
                      Not Connected
                    </div>
                  ) : (
                    <div className="flex items-center justify-center gap-2">
                      <Download size={16} />
                      Start Download
                    </div>
                  )}
                </button>

                {/* Info Section */}
                {preview && (
                  <div className="pt-4 border-t border-zinc-800">
                    <h4 className="text-zinc-400 text-xs mb-2">Download Info</h4>
                    <div className="space-y-2 text-xs text-zinc-500">
                      {preview.duration && (
                        <div className="flex justify-between">
                          <span>Duration:</span>
                          <span className="text-zinc-300">
                            {Math.floor(preview.duration / 60)}:{String(preview.duration % 60).padStart(2, '0')}
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
                          <span>Available Qualities:</span>
                          <span className="text-zinc-300">{qualities.length}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}