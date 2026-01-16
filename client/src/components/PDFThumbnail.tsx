import { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import { FileText, Loader2 } from "lucide-react";

// Configure PDF.js worker - use local worker from node_modules
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!pdfUrl) return;

    // Small delay to ensure canvas is mounted
    const timer = setTimeout(() => {
      if (!canvasRef.current) {
        setError(true);
        setLoading(false);
        return;
      }

    const renderThumbnail = async () => {
      try {
        setLoading(true);
        setError(false);

        const loadingTask = pdfjsLib.getDocument({
          url: pdfUrl,
          withCredentials: false,
          isEvalSupported: false,
          httpHeaders: {
            'Accept': 'application/pdf',
          },
          useSystemFonts: true,
          standardFontDataUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/standard_fonts/',
        });

        const pdf = await loadingTask.promise;
        const page = await pdf.getPage(1); // Get first page

        const canvas = canvasRef.current!;
        const context = canvas.getContext("2d")!;

        // Calculate scale to fit thumbnail (aspect-video = 16:9)
        const viewport = page.getViewport({ scale: 1 });
        const scale = Math.min(
          400 / viewport.width,  // Max width 400px
          225 / viewport.height  // Max height 225px (16:9 ratio)
        );

        const scaledViewport = page.getViewport({ scale });

        canvas.width = scaledViewport.width;
        canvas.height = scaledViewport.height;

        // Enable image smoothing for better quality
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";

        await page.render({
          canvasContext: context,
          viewport: scaledViewport,
          canvas,
        }).promise;

        setLoading(false);
      } catch (err) {
        console.error("Error rendering PDF thumbnail:", err);
        setError(true);
        setLoading(false);
      }
    };

      renderThumbnail();
    }, 100); // Wait 100ms for canvas to mount

    return () => clearTimeout(timer);
  }, [pdfUrl]);

  return (
    <div className={`flex items-center justify-center bg-muted ${className}`}>
      {loading && !error && (
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground/50 absolute" />
      )}
      {error && (
        <FileText className="w-12 h-12 text-muted-foreground/50 absolute" />
      )}
      <canvas 
        ref={canvasRef} 
        className="max-w-full max-h-full object-contain"
        style={{ opacity: loading || error ? 0 : 1 }}
      />
    </div>
  );
}
