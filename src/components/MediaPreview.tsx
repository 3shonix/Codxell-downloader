'use client';
import { motion } from 'framer-motion';
import CustomVideoPlayer from '@/components/x';

interface MediaItem {
  type: 'image' | 'video';
  url: string;
  thumbnail?: string;
}

interface MediaPreviewProps {
  media: MediaItem[];
  backend: string;
}

export default function MediaPreview({ media, backend }: MediaPreviewProps) {
  if (!media || !media.length) return null;

  const hasVideos = media.some(m => m.type === 'video');

  return (
    <div className={`grid gap-4 place-items-center ${media.length === 1
      ? 'grid-cols-1 max-w-full mx-auto'
      : hasVideos
        ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 auto-rows-max'
        : 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3 auto-rows-max'
    } w-full h-full`}>
      {media.map((item, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3, delay: i * 0.08 }}
          className="relative w-full bg-zinc-900/60 border border-zinc-800 rounded-xl overflow-hidden flex items-center justify-center"
          style={{ minHeight: item.type === 'video' ? '300px' : 'auto' }}
        >
          {item.type === 'video' ? (
            <CustomVideoPlayer
              src={`${backend}/api/proxy-video?url=${encodeURIComponent(item.url)}`}
              poster={
                item.thumbnail
                  ? `${backend}/api/proxy-image?url=${encodeURIComponent(item.thumbnail)}`
                  : undefined
              }
              data-preview="false"
              className="w-full h-full object-contain"
            />
          ) : (
            <img
              src={`${backend}/api/proxy-image?url=${encodeURIComponent(item.url)}`}
              alt={`Media ${i + 1}`}
              className="w-auto max-w-full max-h-[65vh] rounded-xl object-contain transition-transform duration-300"
              loading="lazy"
            />
          )}
        </motion.div>
      ))}
    </div>
  );
}
