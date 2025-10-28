'use client';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Download,
  Loader2,
  CheckCircle,
  WifiOff,
  Archive,
  Music,
  AlertCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

interface DownloadSectionProps {
  status: any;
  url: string;
  platform: string;
  preview: any;
  downloading: boolean;
  downloadType: 'video' | 'audio' | null;
  loadingPreview: boolean;
  connected: boolean;
  downloadingMetadata: boolean;
  handleBrowserDownload: () => void;
  handleMultiDownload: () => void;
  handleDownloadZip: () => void;
  handleDownloadWithMetadata: () => void;
  startDownload: (type: 'video' | 'audio') => void;
}

export default function DownloadSection({
  status,
  url,
  platform,
  preview,
  downloading,
  downloadType,
  loadingPreview,
  connected,
  downloadingMetadata,
  handleBrowserDownload,
  handleMultiDownload,
  handleDownloadZip,
  handleDownloadWithMetadata,
  startDownload,
}: DownloadSectionProps) {
  const getButtonState = () => {
    if (downloading) return 'processing';
    if (loadingPreview) return 'loading';
    if (!connected) return 'disconnected';
    if (!platform) return 'no-platform';
    return 'ready';
  };

  const buttonState = getButtonState();

  return (
    <div className="space-y-4">
      <AnimatePresence mode="wait">
        {status?.status === 'completed' && url === status?.original_url ? (
          <motion.div
            key="completed"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-4"
          >
            

            {/* ✅ Primary Download Button */}
            <Button
              onClick={handleBrowserDownload}
              className="w-full py-4 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 text-white rounded-xl font-semibold text-sm transition-all duration-200 border border-green-500/50 flex items-center justify-center gap-3 shadow-lg hover:shadow-green-500/25"
            >
              <Download size={20} />
              {(status.download_type || downloadType) === 'audio'
                ? 'Download Audio (MP3)'
                : 'Download Video'}
            </Button>

            {/* ✅ Secondary Actions */}
            <div className="space-y-2">
              {(status.downloaded_files?.length > 1 || status.direct_links?.length > 1) && (
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    onClick={handleMultiDownload}
                    variant="secondary"
                    className="py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-sm font-medium transition-all border border-zinc-700 flex items-center justify-center gap-2 hover:border-zinc-600"
                  >
                    <Download size={16} />
                    All Files
                  </Button>
                  <Button
                    onClick={handleDownloadZip}
                    className="py-2.5 bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg text-sm font-medium transition-all border border-zinc-600 flex items-center justify-center gap-2"
                  >
                    <Archive size={16} />
                    ZIP
                  </Button>
                </div>
              )}

              {/* ✅ Metadata ZIP */}
              <Button
                onClick={handleDownloadWithMetadata}
                disabled={downloadingMetadata}
                className="w-full py-2.5 bg-blue-900/20 hover:bg-blue-900/30 text-blue-400 rounded-lg text-sm font-medium transition-all border border-blue-800/50 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {downloadingMetadata ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Creating ZIP...
                  </>
                ) : (
                  <>
                    <Archive size={16} />
                    Download with Metadata
                  </>
                )}
              </Button>

              {/* ✅ Extract Audio Option */}
              {status.download_type !== 'audio' &&
                ['youtube', 'instagram', 'pinterest'].includes(platform) &&
                (preview?.video_url || preview?.media?.some((m: any) => m.type === 'video')) && (
                  <Button
                    onClick={() => startDownload('audio')}
                    disabled={downloading}
                    className="w-full py-2.5 bg-purple-900/20 hover:bg-purple-900/30 text-purple-400 rounded-lg text-sm font-medium transition-all border border-purple-800/50 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {downloading && downloadType === 'audio' ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        Extracting Audio...
                      </>
                    ) : (
                      <>
                        <Music size={16} />
                        Extract Audio Only
                      </>
                    )}
                  </Button>
                )}
            </div>
          </motion.div>
        ) : (
          // ⚙️ Default State
          <motion.div
            key="normal"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-3"
          >
            {/* ✅ Primary Download Button */}
            <Button
              onClick={() => startDownload('video')}
              disabled={buttonState !== 'ready'}
              className={`w-full py-4 rounded-xl font-semibold text-sm transition-all duration-200 flex items-center justify-center gap-3 ${buttonState === 'ready'
                  ? 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white border border-blue-500/50 shadow-lg hover:shadow-blue-500/25'
                  : 'bg-zinc-800 text-zinc-500 border border-zinc-700 cursor-not-allowed'
                }`}
            >
              {buttonState === 'processing' && downloadType === 'video' ? (
                <>
                  <Loader2 className="animate-spin" size={20} />
                  Processing Video...
                </>
              ) : buttonState === 'loading' ? (
                <>
                  <Loader2 className="animate-spin" size={20} />
                  Loading Preview...
                </>
              ) : buttonState === 'disconnected' ? (
                <>
                  <WifiOff size={20} />
                  Server Disconnected
                </>
              ) : buttonState === 'no-platform' ? (
                <>
                  <AlertCircle size={20} />
                  Invalid URL
                </>
              ) : (
                <>
                  <Download size={20} />
                  Download Video + Audio
                </>
              )}
            </Button>

            {/* ✅ Audio-only Option */}
            {['youtube', 'instagram', 'pinterest'].includes(platform) &&
              (preview?.video_url || preview?.media?.some((m: any) => m.type === 'video')) && (
                <div className="space-y-2">
                  <Button
                    onClick={() => startDownload('audio')}
                    disabled={buttonState !== 'ready'}
                    className={`w-full py-3 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2 ${buttonState === 'ready'
                        ? 'bg-purple-900/20 hover:bg-purple-900/30 text-purple-400 border border-purple-800/50'
                        : 'bg-zinc-800/50 text-zinc-600 border border-zinc-800 cursor-not-allowed'
                      }`}
                  >
                    {buttonState === 'processing' && downloadType === 'audio' ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        Extracting Audio...
                      </>
                    ) : (
                      <>
                        <Music size={16} />
                        Audio Only (MP3)
                      </>
                    )}
                  </Button>
                </div>
              )}

            {/* ℹ️ Status Messages */}
            {buttonState !== 'ready' && (
              <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-3">
                <p className="text-xs text-zinc-400">
                  {buttonState === 'loading' && 'Loading preview...'}
                  {buttonState === 'disconnected' && 'Please check your connection and try again.'}
                  {buttonState === 'no-platform' && 'Please enter a valid YouTube, Instagram, or Pinterest URL.'}
                  {buttonState === 'processing' && 'Processing your request...'}
                </p>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
