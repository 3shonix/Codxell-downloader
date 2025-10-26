"use client";

import { useRef, useState, useEffect } from "react";
import Hls from "hls.js";
import { Play, Pause, Volume2, VolumeX, Maximize, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

// ✅ Clean, production-optimized, low overhead video player
export default function CustomVideoPlayer({ src, poster }: { src: string; poster?: string }) {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const containerRef = useRef<HTMLDivElement | null>(null);

    // Minimal state — only what’s needed for re-rendering
    const [playing, setPlaying] = useState(false);
    const [muted, setMuted] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [progress, setProgress] = useState(0);
    const [duration, setDuration] = useState(0);
    const [hover, setHover] = useState(false);

    // 🧠 HLS Support
    useEffect(() => {
        const v = videoRef.current;
        if (!v || !src) return;

        // Handle HLS streams
        if (src.endsWith(".m3u8") && Hls.isSupported()) {
            const hls = new Hls({ maxBufferLength: 20 });
            hls.loadSource(src);
            hls.attachMedia(v);
            hls.on(Hls.Events.MANIFEST_PARSED, () => setIsLoading(false));
            return () => hls.destroy();
        } else {
            v.src = src;
            v.onloadedmetadata = () => setIsLoading(false);
        }
    }, [src]);

    // 🕹️ Core controls
    const togglePlay = () => {
        const v = videoRef.current;
        if (!v) return;
        if (v.paused) {
            v.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
        } else {
            v.pause();
            setPlaying(false);
        }
    };

    const toggleMute = () => {
        const v = videoRef.current;
        if (!v) return;
        v.muted = !v.muted;
        setMuted(v.muted);
    };

    const toggleFullscreen = () => {
        const el = containerRef.current;
        if (!el) return;
        if (!document.fullscreenElement) el.requestFullscreen();
        else document.exitFullscreen();
    };

    // 🧮 Update progress (only runs internally, not every frame)
    useEffect(() => {
        const v = videoRef.current;
        if (!v) return;
        const update = () => {
            if (v.duration) {
                setProgress((v.currentTime / v.duration) * 100);
                setDuration(v.duration);
            }
        };
        v.addEventListener("timeupdate", update);
        v.addEventListener("ended", () => setPlaying(false));
        return () => v.removeEventListener("timeupdate", update);
    }, []);

    const formatTime = (t: number) =>
        !isFinite(t) || t < 0 ? "0:00" : `${Math.floor(t / 60)}:${Math.floor(t % 60).toString().padStart(2, "0")}`;

    return (
        <div
            ref={containerRef}
            className="relative w-full bg-black rounded-xl overflow-hidden group"
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
        >
            <video
                ref={videoRef}
                poster={poster}
                className="w-full h-full max-h-[75vh] object-contain"
                playsInline
                preload="metadata"
                controls={false}
                onClick={togglePlay}
            />

            {/* Loading Spinner */}
            <AnimatePresence>
                {isLoading && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="absolute inset-0 flex items-center justify-center bg-black/40"
                    >
                        <Loader2 className="w-10 h-10 text-white animate-spin" />
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Play Overlay */}
            <AnimatePresence>
                {!playing && !isLoading && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="absolute inset-0 flex items-center justify-center"
                    >
                        <div className="w-16 h-16 bg-black/70 rounded-full flex items-center justify-center">
                            <Play size={30} fill="white" />
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Controls */}
            <motion.div
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: hover || !playing ? 1 : 0, y: hover || !playing ? 0 : 15 }}
                transition={{ duration: 0.25 }}
                className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black via-black/70 to-transparent p-4"
            >
                {/* Progress Bar */}
                <div className="relative h-1 w-full bg-white/20 rounded-full mb-3 cursor-pointer">
                    <div className="absolute top-0 left-0 h-full bg-white rounded-full" style={{ width: `${progress}%` }} />
                </div>

                {/* Control Row */}
                <div className="flex items-center justify-between text-white text-sm">
                    <div className="flex items-center gap-2">
                        <button onClick={togglePlay} className="p-2 hover:bg-white/10 rounded-lg">
                            {playing ? <Pause size={18} /> : <Play size={18} />}
                        </button>

                        <button onClick={toggleMute} className="p-2 hover:bg-white/10 rounded-lg">
                            {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
                        </button>

                        <span className="text-xs opacity-80">{formatTime(duration * (progress / 100))} / {formatTime(duration)}</span>
                    </div>

                    <button onClick={toggleFullscreen} className="p-2 hover:bg-white/10 rounded-lg">
                        <Maximize size={18} />
                    </button>
                </div>
            </motion.div>
        </div>
    );
}
