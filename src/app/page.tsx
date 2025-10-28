'use client';
import { motion } from 'framer-motion';
import { Download, ArrowRight, Sparkles, Zap, Layers } from 'lucide-react';
import Link from 'next/link';

export default function Home() {
  return (
    <div className="min-h-screen bg-zinc-950 relative overflow-hidden flex items-center justify-center">
      {/* Background Gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950" />
      
      {/* Content */}
      <div className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="text-center mb-12">
          {/* Logo/Icon */}
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 200, damping: 15 }}
            className="mb-6 flex justify-center"
          >
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-2xl">
              <Download className="w-10 h-10 text-white" />
            </div>
          </motion.div>

          {/* Heading */}
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-5xl sm:text-6xl md:text-7xl font-bold text-white mb-4"
          >
            Media Downloader
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="text-xl sm:text-2xl text-zinc-400 max-w-3xl mx-auto mb-12"
          >
            Download high-quality videos, images, and audio from YouTube, Instagram, and Pinterest
          </motion.p>

          {/* CTA Button */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
          >
            <Link
              href="/downloader"
              className="inline-flex items-center gap-2 px-8 py-4 bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white font-semibold rounded-xl transition-all shadow-lg hover:shadow-xl text-lg group"
            >
              Start Downloading
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </Link>
          </motion.div>
        </div>

        {/* Features */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto"
        >
          {/* Feature 1 */}
          <div className="p-8 bg-zinc-900/50 backdrop-blur-sm border border-zinc-800 rounded-2xl hover:border-blue-500/50 transition-all group">
            <div className="w-14 h-14 bg-blue-500/10 rounded-xl flex items-center justify-center mb-4 group-hover:bg-blue-500/20 transition-colors">
              <Sparkles className="w-7 h-7 text-blue-400" />
            </div>
            <h3 className="text-xl font-semibold text-white mb-2">High Quality</h3>
            <p className="text-zinc-400">
              Download in original quality up to 4K resolution with crystal clear audio
            </p>
          </div>

          {/* Feature 2 */}
          <div className="p-8 bg-zinc-900/50 backdrop-blur-sm border border-zinc-800 rounded-2xl hover:border-purple-500/50 transition-all group">
            <div className="w-14 h-14 bg-purple-500/10 rounded-xl flex items-center justify-center mb-4 group-hover:bg-purple-500/20 transition-colors">
              <Zap className="w-7 h-7 text-purple-400" />
            </div>
            <h3 className="text-xl font-semibold text-white mb-2">Fast & Reliable</h3>
            <p className="text-zinc-400">
              Quick downloads with real-time progress tracking and instant previews
            </p>
          </div>

          {/* Feature 3 */}
          <div className="p-8 bg-zinc-900/50 backdrop-blur-sm border border-zinc-800 rounded-2xl hover:border-green-500/50 transition-all group">
            <div className="w-14 h-14 bg-green-500/10 rounded-xl flex items-center justify-center mb-4 group-hover:bg-green-500/20 transition-colors">
              <Layers className="w-7 h-7 text-green-400" />
            </div>
            <h3 className="text-xl font-semibold text-white mb-2">Metadata Preserved</h3>
            <p className="text-zinc-400">
              Keep titles, descriptions, and other metadata with your downloaded content
            </p>
          </div>
        </motion.div>

        {/* Platform Support */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
          className="mt-16 text-center"
        >
          <p className="text-zinc-500 text-sm mb-6">Supported Platforms</p>
          <div className="flex justify-center items-center gap-8 flex-wrap">
            <div className="flex items-center gap-3 px-6 py-3 bg-red-900/10 border border-red-800/50 rounded-xl">
              <div className="w-3 h-3 bg-red-500 rounded-full" />
              <span className="text-red-400 font-medium">YouTube</span>
            </div>
            <div className="flex items-center gap-3 px-6 py-3 bg-pink-900/10 border border-pink-800/50 rounded-xl">
              <div className="w-3 h-3 bg-pink-500 rounded-full" />
              <span className="text-pink-400 font-medium">Instagram</span>
            </div>
            <div className="flex items-center gap-3 px-6 py-3 bg-red-900/10 border border-red-800/50 rounded-xl">
              <div className="w-3 h-3 bg-red-500 rounded-full" />
              <span className="text-red-400 font-medium">Pinterest</span>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}