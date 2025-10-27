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

  const getStatusIcon = () => {
    if (isError) return 'Error';
    if (isCancelling) return 'Cancelling';
    if (isProcessing) return 'Processing';
    return 'Download';
  };

  const getStatusColor = () => {
    if (isError) return 'red';
    if (isCancelling) return 'yellow';
    if (isProcessing) return 'blue';
    return 'zinc';
  };

  const statusColor = getStatusColor();

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 20, scale: 0.95 }}
        transition={{ type: "spring", damping: 20, stiffness: 300 }}
        className="mt-6 pt-6 border-t border-zinc-800"
      >
        {/* Enhanced Status Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${
              statusColor === 'red' ? 'bg-red-500/20' :
              statusColor === 'yellow' ? 'bg-yellow-500/20' :
              statusColor === 'blue' ? 'bg-blue-500/20' :
              'bg-zinc-500/20'
            }`}>
              {(isProcessing || isCancelling) ? (
                <Loader2 className={`animate-spin ${
                  statusColor === 'red' ? 'text-red-400' :
                  statusColor === 'yellow' ? 'text-yellow-400' :
                  statusColor === 'blue' ? 'text-blue-400' :
                  'text-zinc-400'
                }`} size={20} />
              ) : (
                <span className="text-sm font-medium">{getStatusIcon()}</span>
              )}
            </div>
            <div>
              <span className={`font-semibold text-sm capitalize block ${
                statusColor === 'red' ? 'text-red-400' :
                statusColor === 'yellow' ? 'text-yellow-400' :
                statusColor === 'blue' ? 'text-blue-400' :
                'text-white'
              }`}>
                {status.status === 'queued' ? 'In Queue' :
                 status.status === 'downloading' ? 'Downloading' :
                 status.status === 'processing' ? 'Processing' :
                 status.status === 'cancelling' ? 'Cancelling' :
                 status.status}
              </span>
              <span className={`text-xs ${
                statusColor === 'red' ? 'text-red-300/70' :
                statusColor === 'yellow' ? 'text-yellow-300/70' :
                statusColor === 'blue' ? 'text-blue-300/70' :
                'text-zinc-400'
              }`}>
                {status.message}
              </span>
            </div>
          </div>

          {reconnecting && (
            <motion.div
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-yellow-900/20 border border-yellow-800/50 rounded-lg"
            >
              <AlertCircle size={14} className="text-yellow-400" />
              <span className="text-yellow-400 text-xs font-medium">Reconnecting</span>
            </motion.div>
          )}
        </div>

        {/* Enhanced Progress Bar */}
        {status.progress !== undefined && isProcessing && (
          <div className="mb-4 space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-zinc-400 font-medium">Download Progress</span>
              <div className="flex items-center gap-2">
                <span className="text-white font-bold tabular-nums text-lg">
                  {Math.min(status.progress || 0, 100)}%
                </span>
                <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse"></div>
              </div>
            </div>
            <div className="relative h-3 w-full bg-zinc-800/50 rounded-full overflow-hidden backdrop-blur-sm border border-zinc-800">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${status.progress}%` }}
                transition={{ duration: 0.5, ease: 'easeOut' }}
                className="absolute inset-y-0 left-0 bg-gradient-to-r from-blue-500 via-blue-400 to-blue-500 rounded-full"
              />
              <motion.div
                className="absolute inset-y-0 left-0 bg-gradient-to-r from-transparent via-white/40 to-transparent"
                style={{ width: `${status.progress}%` }}
                animate={{ x: ['0%', '100%'] }}
                transition={{
                  repeat: Infinity,
                  duration: 2,
                  ease: "linear"
                }}
              />
              {/* Progress dots */}
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-1 h-1 bg-white/60 rounded-full animate-pulse"></div>
              </div>
            </div>
            
            {/* Progress details */}
            <div className="flex justify-between text-xs text-zinc-500">
              <span>Started</span>
              <span>ETA: {status.progress > 10 ? `${Math.max(1, Math.round((100 - status.progress) / 10))} min` : 'Calculating...'}</span>
            </div>
          </div>
        )}

        {/* Enhanced Error Message */}
        {isError && status.error && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="mb-4 p-4 bg-red-900/20 border border-red-800/50 rounded-xl"
          >
            <div className="flex items-start gap-3">
              <div className="bg-red-500/20 p-1.5 rounded-lg mt-0.5">
                <XCircle className="text-red-400" size={16} />
              </div>
              <div>
                <h4 className="text-red-400 font-medium text-sm mb-1">Download Failed</h4>
                <p className="text-red-300 text-xs leading-relaxed">{status.error}</p>
              </div>
            </div>
          </motion.div>
        )}

        {/* Action Buttons */}
        <div className="space-y-2">
          {/* Cancel Button */}
          {isProcessing && (
            <motion.button
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={cancel}
              disabled={isCancelling}
              className="w-full px-4 py-3 bg-red-900/30 hover:bg-red-900/40 text-red-400 rounded-xl text-sm font-medium transition-all border border-red-800/50 hover:border-red-700/50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isCancelling ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Cancelling Download...
                </>
              ) : (
                <>
                  <span className="text-sm">Cancel</span>
                  Cancel Download
                </>
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
              className="w-full px-4 py-3 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl text-sm font-medium transition-all border border-zinc-700 flex items-center justify-center gap-2"
            >
              <span className="text-sm">Retry</span>
              Try Again
            </motion.button>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}