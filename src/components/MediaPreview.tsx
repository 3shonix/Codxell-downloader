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
  const containerRef = useRef<HTMLDivElement>(null);

  if (!media?.length) return null;

  const hasVideos = media.some((m) => m.type === 'video');
  const isLimited = media.length > limit;
  const visibleMedia = expanded ? media : media.slice(0, limit);

  useEffect(() => {
    if (!expanded && containerRef.current) {
      containerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [expanded]);

  return (
    <section className={`relative w-full flex flex-col p-6 items-center justify-center`}>
      {/* Media Grid */}
      <div
        ref={containerRef}
        className={`w-full transition-all duration-500 ${media.length === 1
            ? 'flex justify-center items-center' // ✅ center when one item
            : hasVideos
              ? 'grid grid-cols-1 sm:grid-cols-2'
              : 'grid grid-cols-2 sm:grid-cols-3'
          } ${expanded ? 'max-h-[calc(100vh-200px)] overflow-y-auto' : ''}`}
        style={expanded ? { scrollbarWidth: 'thin' } : {}}
      >

        <AnimatePresence>
          {visibleMedia.map((item, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.25, delay: i * 0.04 }}
              className="relative w-full bg-zinc-900/70 border border-zinc-800 rounded-xl overflow-hidden"
            >
              {/* Media Container with Fixed Aspect Ratio - 9:16 (Portrait) */}
              <div className="relative w-full aspect-[9/16] bg-black rounded-t-xl overflow-hidden max-h-[70vh] sm:max-h-[full] md:max-h-[60vh]">

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
                  <img
                    src={`${backend}/api/proxy-image?url=${encodeURIComponent(item.url)}`}
                    alt={`Media ${i + 1}`}
                    className="absolute inset-0 w-full h-full object-contain transition-transform duration-300 hover:scale-105"
                    loading="lazy"
                  />
                )}
              </div>

              {/* Caption */}
              {item.caption && (
                <div className="p-3 border-t border-zinc-800 bg-zinc-950/80 backdrop-blur-sm">
                  <p className="text-xs text-zinc-300 line-clamp-2 break-words">
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
          className="mt-4 flex items-center gap-2 px-5 py-2.5 bg-zinc-800/90 hover:bg-zinc-700 text-zinc-200 rounded-full border border-zinc-700 text-sm font-medium shadow-md backdrop-blur-md transition-all mx-auto"
        >
          {expanded ? (
            <>
              <ChevronUp size={16} />
              Show Less
            </>
          ) : (
            <>
              <ChevronDown size={16} />
              Show More ({media.length - limit})
            </>
          )}
        </motion.button>
      )}


    </section>
  );
}