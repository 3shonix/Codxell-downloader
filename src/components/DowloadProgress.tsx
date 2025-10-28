'use client';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2Icon, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface DownloadProgressProps {
  status: any;
  reconnecting: boolean;
  handleBrowserDownload?: () => void;
  handleMultiDownload?: () => void;
  cancel: () => void;
}

export default function DownloadProgress({
  status,
  reconnecting,
  cancel,
}: DownloadProgressProps) {
  if (!status || status.status === 'completed') return null;

  const isError = status.status === 'error';
  const isProcessing = ['queued', 'downloading', 'processing'].includes(status.status);
  const isCancelling = status.status === 'cancelling';

  const formatSpeed = (bytesPerSecond: number): string => {
    if (!bytesPerSecond) return '—';
    if (bytesPerSecond >= 1024 * 1024)
      return `${(bytesPerSecond / (1024 * 1024)).toFixed(2)} MB/s`;
    return `${(bytesPerSecond / 1024).toFixed(2)} KB/s`;
  };

  const formatTime = (seconds: number): string => {
    if (!seconds || seconds === Infinity) return '—';
    if (seconds < 60) return `${Math.round(seconds)}s`;
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return `${m}m ${s}s`;
  };

  const currentSpeed = status.current_speed || 0;
  const etaSeconds = status.eta_seconds;
  const progress = Math.min(status.progress ?? 0, 100);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 8 }}
        transition={{ type: 'spring', damping: 20, stiffness: 260 }}
        className="mt-4 pt-4 border-t border-zinc-800"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="flex-1 min-w-0 flex items-center gap-1.5">
            {isProcessing && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex items-center justify-center"
              >
                <div className="w-3 h-3 border-[2px] border-zinc-500 border-t-white rounded-full animate-spin" />
              </motion.div>
            )}

            {status.message && (
              <div className="text-xs text-zinc-400 truncate leading-tight">
                {status.message}
              </div>
            )}
          </div>

          {reconnecting && (
            <div className="text-xs bg-yellow-900/20 border border-yellow-800/40 text-yellow-300 px-2 py-0.5 rounded-md">
              Reconnecting
            </div>
          )}
        </div>

        {/* Progress Bar */}
        {isProcessing && (
          <div className="mb-1">
            <div className="relative h-[3px] w-full bg-zinc-800/60 rounded-full overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.35, ease: 'easeOut' }}
                className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-blue-500 via-blue-400 to-blue-500"
              />
            </div>
          </div>
        )}

        {/* Speed + ETA */}
        {isProcessing && (
          <div className="flex items-center justify-between text-xs text-zinc-400 mt-2">
            <span className="text-[11px] font-medium text-white tabular-nums">
              {formatSpeed(currentSpeed)}
            </span>
            <span className="text-[11px] font-medium text-white tabular-nums">
              {formatTime(etaSeconds)}
            </span>
          </div>
        )}

        {/* Error Block */}
        {isError && status.error && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="mt-3 p-3 bg-red-900/12 border border-red-800/40 rounded-md"
          >
            <div className="flex items-start gap-3">
              <div className="mt-0.5">
                <XCircle className="text-red-400" size={16} />
              </div>
              <div>
                <div className="text-sm font-medium text-red-400">
                  Download Failed
                </div>
                <div className="text-xs text-red-300 mt-1">{status.error}</div>
              </div>
            </div>
          </motion.div>
        )}

        {/* Action Row */}
        <div className="mt-3 flex flex-col gap-2">
          {isProcessing && (
            <Button
              size="sm"
              variant="destructive"
              onClick={cancel}
              disabled={isCancelling}
              className="w-full flex items-center justify-center gap-2"
            >
              {isCancelling ? (
                <>
                  <Loader2Icon className="animate-spin h-4 w-4" />
                  Cancelling…
                </>
              ) : (
                'Cancel Download'
              )}
            </Button>
          )}

          {isError && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => window.location.reload()}
              className="w-full"
            >
              Retry
            </Button>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
