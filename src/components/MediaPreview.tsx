'use client';
import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronUp } from 'lucide-react';
import CustomVideoPlayer from '@/components/x';

interface MediaItem {
  type: 'image' | 'video';
  url: string;
  thumbnail?: string;
  caption?: string;
}

interface MediaPreviewProps {
  media: MediaItem[];
  backend: string;
  limit?: number;
}

export default function MediaPreview({ media, backend, limit = 6 }: MediaPreviewProps) {
  const [expanded, setExpanded] = useState(false);
  const [loadingStates, setLoadingStates] = useState<boolean[]>([]);
  const [imageErrors, setImageErrors] = useState<boolean[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  if (!media?.length) return null;

  const hasVideos = media.some((m) => m.type === 'video');
  const isLimited = media.length > limit;
  const visibleMedia = expanded ? media : media.slice(0, limit);

  useEffect(() => {
    setLoadingStates(new Array(media.length).fill(true));
    setImageErrors(new Array(media.length).fill(false));
  }, [media.length]);

  const handleImageLoad = (index: number) => {
    setLoadingStates(prev => {
      const newStates = [...prev];
      newStates[index] = false;
      return newStates;
    });
  };

  const handleImageError = (index: number) => {
    setImageErrors(prev => {
      const newErrors = [...prev];
      newErrors[index] = true;
      return newErrors;
    });
    setLoadingStates(prev => {
      const newStates = [...prev];
      newStates[index] = false;
      return newStates;
    });
  };

  return (
    <section className="relative w-full max-h-full flex flex-col flex-1 items-center justify-center overflow-hidden">
      {/* Media Grid */}
      <div
        ref={containerRef}
        className={`w-full flex-1 transition-all duration-500 ${media.length === 1
            ? 'flex justify-center items-center'
            : hasVideos
              ? 'grid grid-cols-1 sm:grid-cols-2'
              : 'grid grid-cols-2 sm:grid-cols-3'
          } ${expanded ? 'max-h-full overflow-hidden' : 'max-h-full'}`}
      >
        <AnimatePresence>
          {visibleMedia.map((item, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.25, delay: i * 0.04 }}
              className="relative w-full h-full bg-zinc-900/70 rounded-xl overflow-hidden group transition-all duration-300"
            >
              {/* Media Container with Fixed Aspect Ratio */}
              <div className="relative w-full aspect-[16/9] bg-black rounded-t-xl overflow-hidden max-h-[full] h-full">

                {/* Loading State */}
                {loadingStates[i] && (
                  <div className="absolute inset-0 flex items-center justify-center bg-zinc-900">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-8 h-8 border-2 border-zinc-600 border-t-blue-500 rounded-full animate-spin"></div>
                      <span className="text-zinc-400 text-xs">Loading...</span>
                    </div>
                  </div>
                )}

                {/* Error State */}
                {imageErrors[i] && item.type === 'image' && (
                  <div className="absolute inset-0 flex items-center justify-center bg-zinc-900">
                    <div className="flex flex-col items-center gap-2 text-zinc-500">
                      <div className="text-lg font-medium">Image</div>
                      <span className="text-xs">Failed to load image</span>
                    </div>
                  </div>
                )}

                {item.type === 'video' ? (
                  <div className="absolute inset-0 w-full h-full">
                    <CustomVideoPlayer
                      src={`${backend}/api/proxy-video?url=${encodeURIComponent(item.url)}`}
                      poster={
                        item.thumbnail
                          ? `${backend}/api/proxy-image?url=${encodeURIComponent(item.thumbnail)}`
                          : undefined
                      }
                    />
                  </div>
                ) : (
                  <div className="relative w-full h-full">
                    <img
                      src={`${backend}/api/proxy-image?url=${encodeURIComponent(item.url)}`}
                      alt={`Media ${i + 1}`}
                      className="absolute inset-0 w-full h-full object-cover blur-sm transition-transform duration-300 opacity-50 group-hover:scale-105"
                      loading="lazy"
                      onLoad={() => handleImageLoad(i)}
                      onError={() => handleImageError(i)}
                    />
                    <img
                      src={`${backend}/api/proxy-image?url=${encodeURIComponent(item.url)}`}
                      alt={`Media ${i + 1}`}
                      className="absolute inset-0 w-full h-full object-contain"
                      loading="lazy"
                      onLoad={() => handleImageLoad(i)}
                      onError={() => handleImageError(i)}
                    />
                  </div>
                )}

                {/* Media Type Badge */}
                <div className="absolute top-2 right-2">
                  <div className={`px-2 py-1 rounded-md text-xs font-medium ${item.type === 'video'
                      ? 'bg-red-900/80 text-red-300 border border-red-800'
                      : 'bg-blue-900/80 text-blue-300 border border-blue-800'
                    }`}>
                    {item.type === 'video' ? 'Video' : 'Image'}
                  </div>
                </div>
              </div>

              {/* Caption */}
              {item.caption && (
                <div className="p-3 border-t border-zinc-800 bg-zinc-950/80 backdrop-blur-sm">
                  <p className="text-xs text-zinc-300 line-clamp-2 break-words leading-relaxed">
                    {item.caption}
                  </p>
                </div>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Show More / Show Less Button */}
      {isLimited && (
        <motion.button
          onClick={() => setExpanded((prev) => !prev)}
          whileTap={{ scale: 0.96 }}
          className="mt-6 flex items-center gap-2 px-6 py-3 bg-zinc-800/90 hover:bg-zinc-700 text-zinc-200 rounded-full border border-zinc-700 text-sm font-medium shadow-lg backdrop-blur-md transition-all mx-auto hover:shadow-xl"
        >
          {expanded ? (
            <>
              <ChevronUp size={16} />
              Show Less
            </>
          ) : (
            <>
              <ChevronDown size={16} />
              Show More ({media.length - limit} more)
            </>
          )}
        </motion.button>
      )}

      {/* Media Count Info */}
      {/* <div className="mt-4 text-center">
        <p className="text-xs text-zinc-500">
          {media.length} {media.length === 1 ? 'item' : 'items'}
          {hasVideos && media.some(m => m.type === 'image') && ' • Mixed media'}
        </p>
      </div> */}
    </section>
  );
}