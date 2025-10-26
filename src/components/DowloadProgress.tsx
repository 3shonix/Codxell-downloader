// old
'use client';
import { motion, AnimatePresence } from 'framer-motion';
import { XCircle, Loader2, AlertCircle } from 'lucide-react';

interface DownloadProgressProps {
  status: any;
  reconnecting: boolean;
  handleBrowserDownload: () => void;
  handleMultiDownload: () => void;
  cancel: () => void;
}

export default function DownloadProgress({
  status,
  reconnecting,
  cancel,
}: DownloadProgressProps) {
  // Don't render if completed or no status
  if (!status || status.status === 'completed') {
    return null;
  }

  const isError = status.status === 'error';
  const isProcessing = ['queued', 'downloading', 'processing'].includes(status.status);
  const isCancelling = status.status === 'cancelling';

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 20, scale: 0.95 }}
        transition={{ type: "spring", damping: 20, stiffness: 300 }}
        className="mt-6 pt-6 border-t border-zinc-800"
      >
        {/* Status Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            {(isProcessing || isCancelling) && (
              <div className="relative">
                <Loader2 className="text-zinc-400 animate-spin" size={20} />
                <motion.div
                  className="absolute inset-0 rounded-full border-2 border-zinc-600"
                  animate={{ rotate: 360 }}
                  transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                />
              </div>
            )}
            {isError && (
              <div className="bg-red-500/20 p-1.5 rounded-lg">
                <XCircle className="text-red-400" size={20} />
              </div>
            )}
            <div>
              <span className={`font-semibold text-sm capitalize block ${isError ? 'text-red-400' : 'text-white'
                }`}>
                {status.status}
              </span>
              <span className={`text-xs ${isError ? 'text-red-300/70' : 'text-zinc-400'
                }`}>
                {status.message}
              </span>
            </div>
          </div>

          {reconnecting && (
            <motion.div
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              className="flex items-center gap-1.5 px-2.5 py-1 bg-yellow-900/20 border border-yellow-800/50 rounded-md"
            >
              <AlertCircle size={12} className="text-yellow-400" />
              <span className="text-yellow-400 text-xs font-medium">Reconnecting</span>
            </motion.div>
          )}
        </div>

        {/* Progress Bar */}
        {status.progress !== undefined && isProcessing && (
          <div className="mb-4 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-400">Progress</span>
              <span className="text-white font-semibold tabular-nums">
                {Math.min(status.progress || 0, 100)}%
              </span>
            </div>
            <div className="relative h-2 w-full bg-zinc-800/50 rounded-full overflow-hidden backdrop-blur-sm border border-zinc-800">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${status.progress}%` }}
                transition={{ duration: 0.3, ease: 'easeOut' }}
                className="absolute inset-y-0 left-0 bg-gradient-to-r from-zinc-500 via-zinc-400 to-zinc-500 rounded-full"
              />
              <motion.div
                className="absolute inset-y-0 left-0 bg-gradient-to-r from-transparent via-white/30 to-transparent"
                style={{ width: `${status.progress}%` }}
                animate={{ x: ['0%', '100%'] }}
                transition={{
                  repeat: Infinity,
                  duration: 1.5,
                  ease: "linear"
                }}
              />
            </div>
          </div>
        )}

        {/* Error Message */}
        {isError && status.error && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="mb-4 p-3 bg-red-900/20 border border-red-800/50 rounded-lg"
          >
            <p className="text-red-300 text-xs leading-relaxed">{status.error}</p>
          </motion.div>
        )}

        {/* Cancel Button */}
        {isProcessing && (
          <motion.button
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={cancel}
            disabled={isCancelling}
            className="w-full px-4 py-2.5 bg-red-900/30 hover:bg-red-900/40 text-red-400 rounded-lg text-sm font-medium transition-all border border-red-800/50 hover:border-red-700/50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isCancelling ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 size={14} className="animate-spin" />
                Cancelling...
              </span>
            ) : (
              'Cancel Download'
            )}
          </motion.button>
        )}

        {/* Retry Button for Errors */}
        {isError && (
          <motion.button
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => window.location.reload()}
            className="w-full px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg text-sm font-medium transition-all border border-zinc-700"
          >
            Try Again
          </motion.button>
        )}
      </motion.div>
    </AnimatePresence>
  );
}