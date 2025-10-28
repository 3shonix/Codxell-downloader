'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { Loader2, CheckCircle, AlertCircle, X } from 'lucide-react';

export default function SmartTextarea({
    url,
    setUrl,
    loadingPreview,
    platform,
    fetchPreview,
    startDownload,
}: any) {
    const [expanded, setExpanded] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const debounceRef = useRef<NodeJS.Timeout | null>(null);

    const expandTextarea = useCallback(() => {
        const el = textareaRef.current;
        if (el) {
            el.style.height = 'auto';
            el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
            setExpanded(el.scrollHeight > 50);
        }
    }, []);

    const handleUrlChange = useCallback((value: string) => {
        setUrl(value);
        expandTextarea();

        // Auto-fetch preview with debounce
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            if (value.trim()) fetchPreview();
        }, 500);
    }, [setUrl, expandTextarea, fetchPreview]);

    const handlePaste = useCallback((e: React.ClipboardEvent) => {
        setTimeout(() => {
            expandTextarea();
            const pastedUrl = e.clipboardData.getData('text');
            if (pastedUrl.trim()) {
                // Auto-fetch immediately on paste
                fetchPreview();
            }
        }, 50);
    }, [expandTextarea, fetchPreview]);

    const handleFocus = useCallback(() => setExpanded(true), []);
    const handleBlur = useCallback(() => {
        if (!url.trim()) setExpanded(false);
    }, [url]);

    const clearUrl = useCallback(() => {
        setUrl('');
        setExpanded(false);
        if (textareaRef.current) {
            textareaRef.current.style.height = '42px';
        }
    }, [setUrl]);

    useEffect(() => {
        expandTextarea();
    }, [url, expandTextarea]);

    return (
        <div className="relative group transition-all duration-200">
            <textarea
                ref={textareaRef}
                value={url}
                onChange={(e) => handleUrlChange(e.target.value)}
                onPaste={handlePaste}
                placeholder="Paste your link here..."
                rows={1}
                className={`w-full border border-zinc-700/70 rounded-xl px-4 py-2.5 pr-12 text-sm
          bg-zinc-900/60 text-white placeholder-zinc-500 outline-none resize-none
          transition-all duration-200 ease-in-out
          ${expanded
                        ? 'min-h-[80px] focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/50'
                        : 'min-h-[42px]'}`}
                onFocus={handleFocus}
                onBlur={handleBlur}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' && e.shiftKey) {
                        e.preventDefault();
                        expandTextarea();
                    }
                    if (e.key === 'Enter' && !e.shiftKey && url.trim()) {
                        e.preventDefault();
                        fetchPreview();
                    }
                    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && url.trim() && platform) {
                        e.preventDefault();
                        startDownload('video');
                    }
                    if (e.key === 'Escape') {
                        e.preventDefault();
                        clearUrl();
                    }
                }}
                style={{
                    height: expanded ? 'auto' : '42px',
                    overflow: 'hidden',
                }}
            />

            <div className="absolute right-3 top-2.5 flex items-center space-x-2">
                {url.trim() && (
                    <button
                        onClick={clearUrl}
                        className="text-zinc-400 hover:text-zinc-200 transition-colors"
                        title="Clear (Esc)"
                    >
                        <X size={16} />
                    </button>
                )}
                {loadingPreview ? (
                    <Loader2 size={16} className="animate-spin text-zinc-400" />
                ) : platform ? (
                    <CheckCircle size={16} className="text-green-400" />
                ) : (
                    <AlertCircle size={16} className="text-yellow-400" />
                )}
            </div>
        </div>
    );
}