'use client';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Download,
  Loader2,
  CheckCircle,
  WifiOff,
  Archive,
  Music,
} from 'lucide-react';

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
  return (
    <div className="space-y-3">
      <AnimatePresence mode="wait">
        {status?.status === 'completed' && url === status?.original_url ? (
          <motion.div
            key="completed"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="space-y-3"
          >
            {/* ✅ Success Banner */}
            <div className="bg-green-900/20 border border-green-800/50 rounded-lg p-3">
              <div className="flex items-start gap-2.5">
                <CheckCircle
                  className="text-green-400 mt-0.5 flex-shrink-0"
                  size={18}
                />
                <div>
                  <div className="text-green-400 font-medium text-sm">
                    {status.download_type === 'audio'
                      ? 'Audio Ready'
                      : 'Ready to Download'}
                  </div>
                  <div className="text-green-300/70 text-xs mt-0.5">
                    {status.download_type === 'audio'
                      ? 'MP3 file ready'
                      : status.direct_links?.length > 1 ||
                        status.downloaded_files?.length > 1
                        ? `${status.direct_links?.length ||
                        status.downloaded_files?.length
                        } files ready`
                        : 'File is ready'}
                  </div>
                </div>
              </div>
            </div>

            {/* Main Download */}
            <button
              onClick={() => handleBrowserDownload()}
              className="w-full py-3 bg-green-700 hover:bg-green-600 text-white rounded-lg font-medium text-sm transition-colors border border-green-600 flex items-center justify-center gap-2"
            >
              <Download size={18} />
              {console.log(status.download_type,downloadType)}
              {(status.download_type || downloadType) === 'audio'
                ? 'Download Audio (MP3)'
                : 'Download Video'}
            </button>


            {/* Download All */}
            {(status.downloaded_files?.length > 1 ||
              status.direct_links?.length > 1) && (
                <>
                  <button
                    onClick={handleMultiDownload}
                    className="w-full py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-sm font-medium transition-colors border border-zinc-700 flex items-center justify-center gap-2"
                  >
                    <Download size={16} />
                    Download All (
                    {status.direct_links?.length ||
                      status.downloaded_files?.length}
                    )
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

            {/* Metadata ZIP */}
            <button
              onClick={handleDownloadWithMetadata}
              disabled={downloadingMetadata}
              className="w-full py-2.5 bg-blue-900/20 hover:bg-blue-900/30 text-blue-400 rounded-lg text-sm font-medium transition-colors border border-blue-800/50 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {downloadingMetadata ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Creating ZIP...
                </>
              ) : (
                <>
                  <Archive size={16} />
                  ZIP with Details
                </>
              )}
            </button>

            {/* Extract Audio */}
            {status.download_type !== 'audio' &&
              ['youtube', 'instagram', 'pinterest'].includes(platform) &&
              (preview?.video_url ||
                preview?.media?.some((m: any) => m.type === 'video')) && (
                <button
                  onClick={() => startDownload('audio')}
                  disabled={downloading}
                  className="w-full py-2.5 bg-purple-900/20 hover:bg-purple-900/30 text-purple-400 rounded-lg text-sm font-medium transition-colors border border-purple-800/50 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {downloading && downloadType === 'audio' ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      Extracting...
                    </>
                  ) : (
                    <>
                      <Music size={16} />
                      Audio Only (MP3)
                    </>
                  )}
                </button>
              )}
          </motion.div>
        ) : (
          /* 🔘 Default (before completed) */
          <motion.div
            key="normal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="space-y-2"
          >
            <button
              onClick={() => startDownload('video')}
              disabled={downloading || !platform || loadingPreview || !connected}
              className="w-full py-3 bg-zinc-800 hover:bg-zinc-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed border border-zinc-700 flex items-center justify-center gap-2"
            >
              {downloading && downloadType === 'video' ? (
                <>
                  <Loader2 className="animate-spin" size={18} />
                  Processing...
                </>
              ) : loadingPreview ? (
                <>
                  <Loader2 className="animate-spin" size={18} />
                  Loading...
                </>
              ) : !connected ? (
                <>
                  <WifiOff size={18} />
                  Not Connected
                </>
              ) : (
                <>
                  <Download size={18} />
                  Download Video + Audio
                </>
              )}
            </button>

            {/* Audio-only Option */}
            {['youtube', 'instagram', 'pinterest'].includes(platform) &&
              (preview?.video_url ||
                preview?.media?.some((m: any) => m.type === 'video')) && (
                <>
                  <button
                    onClick={() => startDownload('audio')}
                    disabled={
                      downloading || !platform || loadingPreview || !connected
                    }
                    className="w-full py-2.5 bg-purple-900/20 hover:bg-purple-900/30 text-purple-400 rounded-lg text-sm font-medium transition-colors border border-purple-800/50 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {downloading && downloadType === 'audio' ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        Extracting...
                      </>
                    ) : (
                      <>
                        <Music size={16} />
                        Audio Only (MP3)
                      </>
                    )}
                  </button>
                  <p className="text-xs text-zinc-500 text-center pt-1">
                    💡 Choose video+audio for full quality, or audio-only for
                    music
                  </p>
                </>
              )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
