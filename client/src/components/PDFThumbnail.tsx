import { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import { FileText, Loader2 } from "lucide-react";

// Configure PDF.js worker once at module level
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

interface PDFThumbnailProps {
  pdfUrl: string;
  className?: string;
}

export function PDFThumbnail({ pdfUrl, className = "" }: PDFThumbnailProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [isVisible, setIsVisible] = useState(false);

  // Lazy-load: only render the PDF when the card scrolls into view
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setIsVisible(true); observer.disconnect(); } },
      { rootMargin: "200px" } // start loading 200px before visible
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!pdfUrl || !isVisible) return;

    let cancelled = false;

    const renderThumbnail = async () => {
      try {
        setLoading(true);
        setError(false);

        const loadingTask = pdfjsLib.getDocument({
          url: pdfUrl,
          withCredentials: false,
          isEvalSupported: false,
          httpHeaders: { 'Accept': 'application/pdf' },
          useSystemFonts: true,
          standardFontDataUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/standard_fonts/',
        });

        const pdf = await loadingTask.promise;
        if (cancelled) return;
        const page = await pdf.getPage(1);
        if (cancelled) return;

        const canvas = canvasRef.current;
        if (!canvas) { setError(true); setLoading(false); return; }
        const context = canvas.getContext("2d")!;

        const viewport = page.getViewport({ scale: 1 });
        const scale = Math.min(400 / viewport.width, 225 / viewport.height);
        const scaledViewport = page.getViewport({ scale });

        canvas.width = scaledViewport.width;
        canvas.height = scaledViewport.height;
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";

        await page.render({ canvasContext: context, viewport: scaledViewport, canvas }).promise;
        if (!cancelled) setLoading(false);
      } catch (err) {
        if (!cancelled) { console.error("PDF thumbnail error:", err); setError(true); setLoading(false); }
      }
    };

    renderThumbnail();
    return () => { cancelled = true; };
  }, [pdfUrl, isVisible]);

  return (
    <div ref={wrapperRef} className={`flex items-center justify-center bg-muted ${className}`}>
      {loading && !error && (
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground/50 absolute" />
      )}
      {error && (
        <FileText className="w-12 h-12 text-muted-foreground/50 absolute" />
      )}
      <canvas 
        ref={canvasRef} 
        className="max-w-full max-h-full object-contain"
        style={{ opacity: loading || error ? 0 : 1, transition: 'opacity 0.2s ease' }}
      />
    </div>
  );
}
