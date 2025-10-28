"use client";

import { useRef, useState, useEffect } from "react";
import { Play, Pause, Square, Volume2, VolumeX, Maximize, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function CustomVideoPlayer({ src, poster }: { src: string; poster?: string }) {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const progressRef = useRef<HTMLDivElement | null>(null);

    const [playing, setPlaying] = useState(false);
    const [muted, setMuted] = useState(false);
    const [volume, setVolume] = useState(0.7);
    const [progress, setProgress] = useState(0);
    const [duration, setDuration] = useState(0);
    const [currentTime, setCurrentTime] = useState(0);
    const [hover, setHover] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [buffered, setBuffered] = useState(0);
    const [showVolumeSlider, setShowVolumeSlider] = useState(false);

    const togglePlay = (e?: React.MouseEvent) => {
        e?.stopPropagation();
        const v = videoRef.current;
        if (!v) return;

        if (v.paused) {
            const playPromise = v.play();
            if (playPromise !== undefined) {
                playPromise
                    .then(() => setPlaying(true))
                    .catch(err => {
                        console.warn("Play prevented:", err);
                        setPlaying(false);
                    });
            }
        } else {
            v.pause();
            setPlaying(false);
        }
    };

    const stopVideo = (e: React.MouseEvent) => {
        e.stopPropagation();
        const v = videoRef.current;
        if (!v) return;
        v.pause();
        v.currentTime = 0;
        setPlaying(false);
        setProgress(0);
        setCurrentTime(0);
    };

    const toggleMute = (e: React.MouseEvent) => {
        e.stopPropagation();
        const v = videoRef.current;
        if (!v) return;

        const newMutedState = !v.muted;
        v.muted = newMutedState;
        setMuted(newMutedState);

        if (!newMutedState && v.volume === 0) {
            v.volume = 0.7;
            setVolume(0.7);
        }
    };

    const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        e.stopPropagation();
        const v = videoRef.current;
        if (!v) return;

        const newVolume = parseFloat(parseFloat(e.target.value).toFixed(2));
        v.volume = newVolume;
        setVolume(newVolume);

        if (newVolume > 0 && v.muted) {
            v.muted = false;
            setMuted(false);
        } else if (newVolume === 0) {
            setMuted(true);
        }
    };

    const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
        e.stopPropagation();
        const v = videoRef.current;
        if (!v || !duration || !progressRef.current) return;

        const rect = progressRef.current.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const percent = Math.max(0, Math.min(1, clickX / rect.width));
        const newTime = percent * duration;

        v.currentTime = newTime;
        setCurrentTime(newTime);
        setProgress(percent * 100);
    };

    const toggleFullscreen = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!containerRef.current) return;

        if (!document.fullscreenElement) {
            containerRef.current.requestFullscreen().catch(err =>
                console.warn("Fullscreen error:", err)
            );
        } else {
            document.exitFullscreen();
        }
    };

    useEffect(() => {
        const v = videoRef.current;
        if (!v) return;

        // Only auto-mute autoplaying previews (not YouTube preview playback)
        const isPreviewAutoplay = v.getAttribute("data-preview") === "true";
        v.muted = isPreviewAutoplay;
        v.volume = isPreviewAutoplay ? 0 : 0.7;

        const updateProgress = () => {
            if (v.duration && isFinite(v.duration)) {
                const current = v.currentTime;
                const dur = v.duration;
                setCurrentTime(current);
                setProgress((current / dur) * 100);
            }
        };

        const updateBuffered = () => {
            if (v.buffered.length > 0 && v.duration) {
                const bufferedEnd = v.buffered.end(v.buffered.length - 1);
                setBuffered((bufferedEnd / v.duration) * 100);
            }
        };

        const handleLoadedMetadata = () => {
            const dur = v.duration;
            if (isFinite(dur) && dur > 0) {
                setDuration(dur);
                setIsLoading(false);
            }
        };

        const handleCanPlay = () => {
            setIsLoading(false);
            const dur = v.duration;
            if (isFinite(dur) && dur > 0) {
                setDuration(dur);
            }
        };

        const handleWaiting = () => setIsLoading(true);
        const handlePlaying = () => setIsLoading(false);

        const handleEnded = () => {
            setPlaying(false);
            setProgress(0);
            setCurrentTime(0);
            v.currentTime = 0;
        };

        const handleVolumeUpdate = () => {
            setVolume(v.volume);
            setMuted(v.muted);
        };

        v.addEventListener("timeupdate", updateProgress);
        v.addEventListener("progress", updateBuffered);
        v.addEventListener("loadedmetadata", handleLoadedMetadata);
        v.addEventListener("canplay", handleCanPlay);
        v.addEventListener("waiting", handleWaiting);
        v.addEventListener("playing", handlePlaying);
        v.addEventListener("ended", handleEnded);
        v.addEventListener("volumechange", handleVolumeUpdate);

        return () => {
            v.removeEventListener("timeupdate", updateProgress);
            v.removeEventListener("progress", updateBuffered);
            v.removeEventListener("loadedmetadata", handleLoadedMetadata);
            v.removeEventListener("canplay", handleCanPlay);
            v.removeEventListener("waiting", handleWaiting);
            v.removeEventListener("playing", handlePlaying);
            v.removeEventListener("ended", handleEnded);
            v.removeEventListener("volumechange", handleVolumeUpdate);
        };
    }, []);


    const formatTime = (seconds: number) => {
        if (!isFinite(seconds) || isNaN(seconds) || seconds < 0) {
            return "0:00";
        }

        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);

        if (hours > 0) {
            return `${hours}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
        }
        return `${minutes}:${secs.toString().padStart(2, "0")}`;
    };

    return (
        <div
            ref={containerRef}
            className="relative w-full bg-black rounded-xl overflow-hidden group max-h-[full] h-full"
            style={{
                aspectRatio: '16/9',
            }}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
        >
            <video
                ref={videoRef}
                src={src}
                poster={poster}
                className="w-full h-full object-contain cursor-pointer"
                playsInline

                controls={false}
                disablePictureInPicture
                controlsList="nodownload nofullscreen noremoteplayback"
                onContextMenu={(e) => e.preventDefault()}
                draggable={false}
                onDragStart={(e) => e.preventDefault()}

                preload="metadata"
                onClick={togglePlay}
                style={{
                    display: 'block'
                }}
            />

            {/* Loading Spinner */}
            <AnimatePresence>
                {isLoading && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="absolute inset-0 flex items-center justify-center bg-black/30 pointer-events-none"
                    >
                        <Loader2 className="w-12 h-12 text-white animate-spin" />
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Play/Pause Overlay */}
            <AnimatePresence>
                {!playing && !isLoading && (
                    <motion.div
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.8 }}
                        transition={{ duration: 0.2 }}
                        className="absolute inset-0 flex items-center justify-center pointer-events-none"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="w-20 h-20 bg-black/70 backdrop-blur-sm rounded-full flex items-center justify-center shadow-2xl border-2 border-white/20">
                            <Play size={36} className="text-white ml-1.5" fill="white" />
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Video Controls */}
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: hover || !playing ? 1 : 1, y: 0 }} // always visible
                transition={{ duration: 0.25, ease: "easeOut" }}
                className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black via-black/80 to-transparent px-4 pb-3 pt-12"
                onClick={(e) => e.stopPropagation()}
            >

                <div className="pointer-events-auto">
                    {/* Progress Bar */}
                    <div
                        ref={progressRef}
                        className="relative h-1.5 w-full bg-white/20 rounded-full overflow-visible cursor-pointer mb-3 group/progress"
                        onClick={handleProgressClick}
                    >
                        {/* Buffered Progress */}
                        <div
                            className="absolute left-0 top-0 h-full bg-white/30 rounded-full transition-all duration-300"
                            style={{ width: `${buffered}%` }}
                        />

                        {/* Current Progress */}
                        <div
                            className="absolute left-0 top-0 h-full bg-white rounded-full transition-all duration-150"
                            style={{ width: `${progress}%` }}
                        />

                        {/* Progress Handle */}
                        <div
                            className="absolute top-1/2 w-3.5 h-3.5 bg-white rounded-full shadow-lg opacity-0 group-hover/progress:opacity-100 transition-all duration-200 pointer-events-none scale-0 group-hover/progress:scale-100"
                            style={{
                                left: `${progress}%`,
                                transform: 'translate(-50%, -50%)',
                            }}
                        />
                    </div>

                    {/* Controls Row */}
                    <div className="flex items-center justify-between text-white">
                        {/* Left Controls */}
                        <div className="flex items-center gap-1">
                            {/* Play/Pause Button */}
                            <button
                                onClick={togglePlay}
                                className="p-2 hover:bg-white/10 rounded-lg transition-all active:scale-95"
                                aria-label={playing ? "Pause" : "Play"}
                            >
                                {playing ? (
                                    <Pause size={20} fill="white" />
                                ) : (
                                    <Play size={20} fill="white" className="ml-0.5" />
                                )}
                            </button>

                            {/* Stop Button */}
                            <button
                                onClick={stopVideo}
                                className="p-2 hover:bg-white/10 rounded-lg transition-all active:scale-95"
                                aria-label="Stop"
                            >
                                <Square size={18} fill="white" />
                            </button>

                            {/* Volume Controls */}
                            <div
                                className="flex items-center gap-1 relative"
                                onMouseEnter={() => setShowVolumeSlider(true)}
                                onMouseLeave={() => setShowVolumeSlider(false)}
                            >
                                <button
                                    onClick={toggleMute}
                                    className="p-2 hover:bg-white/10 rounded-lg transition-all active:scale-95"
                                    aria-label={muted ? "Unmute" : "Mute"}
                                >
                                    {muted || volume === 0 ? (
                                        <VolumeX size={20} />
                                    ) : (
                                        <Volume2 size={20} />
                                    )}
                                </button>

                                {/* Volume Slider */}
                                <motion.div
                                    initial={{ width: 0, opacity: 0 }}
                                    animate={{
                                        width: showVolumeSlider ? 80 : 0,
                                        opacity: showVolumeSlider ? 1 : 0
                                    }}
                                    transition={{ duration: 0.2, ease: "easeOut" }}
                                    className="overflow-hidden"
                                >
                                    <input
                                        type="range"
                                        min="0"
                                        max="1"
                                        step="0.01"
                                        value={volume}
                                        onChange={handleVolumeChange}
                                        className="w-full h-1 bg-white/20 rounded-full appearance-none cursor-pointer
                                        [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 
                                        [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:cursor-pointer
                                        [&::-webkit-slider-thumb]:shadow-lg [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:hover:scale-110
                                        [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:rounded-full 
                                        [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:cursor-pointer
                                        [&::-moz-range-thumb]:shadow-lg"
                                        style={{
                                            background: `linear-gradient(to right, white 0%, white ${volume * 100}%, rgba(255,255,255,0.2) ${volume * 100}%, rgba(255,255,255,0.2) 100%)`
                                        }}
                                        aria-label="Volume"
                                    />
                                </motion.div>
                            </div>

                            {/* Time Display */}
                            <div className="text-xs text-white font-mono ml-2 select-none tabular-nums">
                                {formatTime(currentTime)} / {formatTime(duration)}
                            </div>
                        </div>

                        {/* Right Controls */}
                        <div className="flex items-center">
                            {/* Fullscreen Button */}
                            <button
                                onClick={toggleFullscreen}
                                className="p-2 hover:bg-white/10 rounded-lg transition-all active:scale-95"
                                aria-label="Fullscreen"
                            >
                                <Maximize size={20} />
                            </button>
                        </div>
                    </div>
                </div>
            </motion.div>
        </div>
    );
}