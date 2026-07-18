import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { trpc } from "@/lib/trpc";
import { ArrowLeft, Loader2, Plus, Trash2, Edit2, Save, Download, ZoomIn, ZoomOut, RotateCcw, Maximize2, Eye, EyeOff, FileText, ChevronRight, ChevronDown, Settings2, Type, X } from "lucide-react";
import CategoryManager from "@/components/CategoryManager";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useParams } from "wouter";
import { toast } from "sonner";
import * as pdfjsLib from "pdfjs-dist";
import { jsPDF } from "jspdf";

// Configure PDF.js worker - use local worker from node_modules
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

type Point = { x: number; y: number };

const PRESET_COLORS = [
  "#3b82f6", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6",
  "#ec4899", "#14b8a6", "#f97316", "#6366f1", "#84cc16"
];

const PRESET_CATEGORIES = [
  "Drip Edge",
  "Walk Pads",
  "Coping",
  "Gutter",
  "Roofing Field",
  "Wall",
  "Curbs",
  "Pipes",
  "Other"
];

// Categories that require wall height input after drawing
const WALL_CATEGORIES = ["Wall"];

// Preset categories that use point counting (click to place markers)
const PRESET_POINT_COUNT_CATEGORIES = ["Curbs", "Pipes"];

export default function MeasurementCanvas() {
  const { id } = useParams<{ id: string }>();
  const projectId = parseInt(id || "0");
  const { user, loading: authLoading } = useAuth();
  
  // Fetch custom counting categories
  const { data: customCategories = [] } = trpc.countingCategories.list.useQuery();
  const createCategoryMutation = trpc.countingCategories.create.useMutation();
  const [, setLocation] = useLocation();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);

  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale] = useState(1.0);
  const [scaleUnit, setScaleUnit] = useState("ft");
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentPolygon, setCurrentPolygon] = useState<Point[]>([]);
  const [selectedColor, setSelectedColor] = useState(PRESET_COLORS[0]);
  const [measurementName, setMeasurementName] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("Drip Edge");
  const [isCustomCategory, setIsCustomCategory] = useState(false);
  const [hiddenCategories, setHiddenCategories] = useState<Set<string>>(new Set());
  const [hiddenMeasurements, setHiddenMeasurements] = useState<Set<number>>(new Set());
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [isNameDialogOpen, setIsNameDialogOpen] = useState(false);
  const [editingProjectName, setEditingProjectName] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [notes, setNotes] = useState("");
  const [cursorPosition, setCursorPosition] = useState<Point | null>(null);
  const [zoomLevel, setZoomLevel] = useState(1.0);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });

  // Keep refs in sync with state so event handlers always read fresh values
  useEffect(() => { zoomLevelRef.current = zoomLevel; }, [zoomLevel]);
  useEffect(() => { panOffsetRef.current = panOffset; }, [panOffset]);
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState<Point | null>(null);
  const [isMouseDown, setIsMouseDown] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [selectedMeasurementId, setSelectedMeasurementId] = useState<number | null>(null);
  const [draggingVertexIndex, setDraggingVertexIndex] = useState<number | null>(null);
  const [exactDistance, setExactDistance] = useState("");
  const [isExactMode, setIsExactMode] = useState(false);
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [calibrationPoints, setCalibrationPoints] = useState<Point[]>([]);
  const [calibrationDistance, setCalibrationDistance] = useState("");
  const [isCountingMode, setIsCountingMode] = useState(false);
  const [showCountCategoryDialog, setShowCountCategoryDialog] = useState(false);
  const [isCalibrationDialogOpen, setIsCalibrationDialogOpen] = useState(false);
  const [isShapeClosed, setIsShapeClosed] = useState(false); // Track if user clicked first point to close shape
  const [isWallHeightDialogOpen, setIsWallHeightDialogOpen] = useState(false);
  const [wallHeight, setWallHeight] = useState("");
  const [pendingWallMeasurement, setPendingWallMeasurement] = useState<{
    name: string;
    color: string;
    linearFt: number;
    coordinates: Point[];
  } | null>(null);
  // Touch gesture state
  const [showCategoryManager, setShowCategoryManager] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false); // mobile bottom drawer

  // ─── Text Annotation state ────────────────────────────────────────────────────
  const [isTextMode, setIsTextMode] = useState(false);
  const [selectedTextId, setSelectedTextId] = useState<number | null>(null);
  const [draggingTextId, setDraggingTextId] = useState<number | null>(null);
  const [textDragStart, setTextDragStart] = useState<{ mouseX: number; mouseY: number; origX: number; origY: number } | null>(null);
  const [resizingTextId, setResizingTextId] = useState<number | null>(null);
  const [textResizeStart, setTextResizeStart] = useState<{ mouseX: number; mouseY: number; origW: number; origH: number } | null>(null);
  const [editingTextId, setEditingTextId] = useState<number | null>(null);
  const [editingTextValue, setEditingTextValue] = useState("");
  const lastTouchDistanceRef = useRef<number | null>(null); // for pinch-to-zoom
  const lastTouchCenterRef = useRef<Point | null>(null); // for pinch center
  const touchStartRef = useRef<Point | null>(null); // for single-finger pan
  // Ref to handleCanvasClick to avoid forward-reference issues in touch handlers
  const handleCanvasClickRef = useRef<((e: React.MouseEvent<HTMLCanvasElement>) => void) | null>(null);

  const baseScale = 2.5; // High quality PDF rendering base scale

  // Refs to always have the latest zoom/pan values without stale closures
  const panOffsetRef = useRef({ x: 0, y: 0 });
  const zoomLevelRef = useRef(1.0);

  // RAF throttle ref — prevents redundant canvas redraws within the same animation frame
  const rafIdRef = useRef<number | null>(null);

  const utils = trpc.useUtils();
  const { data: project, isLoading: projectLoading } = trpc.projects.get.useQuery({ id: projectId });
  const { data: measurements, isLoading: measurementsLoading } = trpc.measurements.list.useQuery({ projectId });

  // Memoize category grouping — recomputed only when measurements change, not on every render
  const measurementsByCategory = useMemo(() => {
    if (!measurements) return {};
    return measurements.reduce((acc, m) => {
      if (!acc[m.name]) acc[m.name] = [];
      acc[m.name].push(m);
      return acc;
    }, {} as Record<string, typeof measurements>);
  }, [measurements]);
  const { data: textAnnotationsList = [] } = trpc.textAnnotations.list.useQuery({ projectId });
  const createTextAnnotationMutation = trpc.textAnnotations.create.useMutation({
    onSuccess: () => utils.textAnnotations.list.invalidate({ projectId }),
  });
  const updateTextAnnotationMutation = trpc.textAnnotations.update.useMutation({
    onSuccess: () => utils.textAnnotations.list.invalidate({ projectId }),
  });
  const deleteTextAnnotationMutation = trpc.textAnnotations.delete.useMutation({
    onSuccess: () => utils.textAnnotations.list.invalidate({ projectId }),
  });

  const updateProjectMutation = trpc.projects.update.useMutation({
    onSuccess: () => {
      utils.projects.get.invalidate({ id: projectId });
      toast.success("Project updated");
      setEditingProjectName(false);
    },
  });

  const createMeasurementMutation = trpc.measurements.create.useMutation({
    onSuccess: () => {
      utils.measurements.list.invalidate({ projectId });
      toast.success("Measurement saved");
      setCurrentPolygon([]);
      setMeasurementName("");
      setIsShapeClosed(false);
      setIsDrawing(false); // Exit drawing mode so the saved measurement is visible immediately
      // redrawOverlay is intentionally NOT called here — the useEffect watching `measurements`
      // fires automatically once the invalidate refetch completes with the fresh data.
    },
  });

  const updateMeasurementMutation = trpc.measurements.update.useMutation({
    onSuccess: () => {
      utils.measurements.list.invalidate({ projectId });
      toast.success("Measurement updated");
      redrawOverlay();
    },
  });

  const deleteMeasurementMutation = trpc.measurements.delete.useMutation({
    // Optimistic update: remove from cache immediately for instant feedback
    onMutate: async (variables) => {
      await utils.measurements.list.cancel({ projectId });
      const previous = utils.measurements.list.getData({ projectId });
      utils.measurements.list.setData(
        { projectId },
        (old) => old?.filter((m) => m.id !== variables.id) ?? old
      );
      return { previous };
    },
    onError: (_err, _variables, context) => {
      // Rollback on error
      if (context?.previous) {
        utils.measurements.list.setData({ projectId }, context.previous);
      }
      toast.error("Failed to delete measurement");
    },
    onSuccess: (_, variables) => {
      toast.success("Measurement deleted");
      setSelectedMeasurementId(null);
      setHiddenMeasurements(prev => {
        const next = new Set(prev);
        next.delete(variables.id);
        return next;
      });
    },
    onSettled: () => {
      utils.measurements.list.invalidate({ projectId });
    },
  });

  // Load PDF
  useEffect(() => {
    if (!project?.pdfUrl) return;

    const loadPdf = async () => {
      try {
        // Loading PDF from URL
        const loadingTask = pdfjsLib.getDocument({
          url: project.pdfUrl,
          withCredentials: false,
          isEvalSupported: false,
          httpHeaders: {
            'Accept': 'application/pdf',
          },
          // Use fetch with CORS mode
          useSystemFonts: true,
          standardFontDataUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/standard_fonts/',
        });
        const pdf = await loadingTask.promise;
        // PDF loaded successfully
        setPdfDoc(pdf);
        setScale(parseFloat(project.scale || "1.0"));
        setScaleUnit(project.scaleUnit || "ft");
        setNotes(project.notes || "");
        setNewProjectName(project.name);
      } catch (error) {
        console.error("Error loading PDF:", error);
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        toast.error(
          `Unable to load PDF. The file may have expired or been moved. Please try uploading the PDF again.`,
          { duration: 10000 }
        );
      }
    };

    loadPdf();
  }, [project]);

  // Fit canvas to screen - used by both auto-fit on load and F key shortcut
  const handleFitToScreen = async (silent = false) => {
    if (!pdfDoc || !containerRef.current) return;
    const page = await pdfDoc.getPage(currentPage);
    const baseScale = 2.5;
    const pdfViewport = page.getViewport({ scale: baseScale });
    const pdfWidth = pdfViewport.width;
    const pdfHeight = pdfViewport.height;
    const container = containerRef.current;
    // Use a generous padding buffer (64px each side = 128px total) to ensure
    // the full PDF is visible with comfortable margins
    const padding = 128;
    const containerWidth = container.clientWidth - padding;
    const containerHeight = container.clientHeight - padding;
    const zoomToFitWidth = containerWidth / pdfWidth;
    const zoomToFitHeight = containerHeight / pdfHeight;
    // Take the smaller ratio so the PDF fits in both dimensions, no 100% cap
    const optimalZoom = Math.max(0.1, Math.min(4.0, Math.min(zoomToFitWidth, zoomToFitHeight)));
    // Update refs immediately so any subsequent zoom events see fresh values
    zoomLevelRef.current = optimalZoom;
    panOffsetRef.current = { x: 0, y: 0 };
    setZoomLevel(optimalZoom);
    setPanOffset({ x: 0, y: 0 });
    if (!silent) toast.success('Fit to screen');
  };

  // Auto-fit zoom when PDF first loads
  useEffect(() => {
    if (!pdfDoc || !containerRef.current) return;
    handleFitToScreen(true); // silent = true, no toast on initial load
  }, [pdfDoc]); // Only run when PDF loads

  // Render PDF page with high quality
  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return;

    const renderPage = async () => {
      const page = await pdfDoc.getPage(currentPage);
      const canvas = canvasRef.current!;
      const context = canvas.getContext("2d")!;

      // High quality rendering: base scale 2.5 for crisp text, multiplied by zoom level
      const viewport = page.getViewport({ scale: baseScale * zoomLevel });
      
      // Set canvas size to match viewport
      canvas.width = viewport.width;
      canvas.height = viewport.height;

      if (overlayCanvasRef.current) {
        overlayCanvasRef.current.width = viewport.width;
        overlayCanvasRef.current.height = viewport.height;
      }

      // Enable image smoothing for better quality
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";

      await page.render({ canvasContext: context, viewport, canvas }).promise;
      redrawOverlay();
    };

    renderPage();
  }, [pdfDoc, currentPage, zoomLevel]);

  // Add keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Backspace key to undo last point while drawing
      if (e.key === 'Backspace' && isDrawing && currentPolygon.length > 0) {
        e.preventDefault();
        setCurrentPolygon(prev => prev.slice(0, -1));
        redrawOverlay();
        return;
      }
      
      // Escape key behavior:
      // 1. If in counting mode -> stop counting
      // 2. If in drawing mode with no points -> stop drawing
      // 3. If in drawing mode with 2+ points -> complete the drawing
      if (e.key === 'Escape') {
        e.preventDefault();
        
        // Stop counting mode
        if (isCountingMode) {
          setIsCountingMode(false);
          setIsDrawing(false);
          setCurrentPolygon([]);
          toast.success('Stopped counting');
          return;
        }
        
        // Stop drawing mode if no points yet
        if (isDrawing && currentPolygon.length === 0) {
          setIsDrawing(false);
          toast.success('Stopped drawing');
          return;
        }
        
        // Complete drawing if 2+ points — open name dialog WITHOUT resetting the category
        if (isDrawing && currentPolygon.length >= 2) {
          setIsNameDialogOpen(true);
        }
      }
      
      // Delete key to remove selected measurement
      if (e.key === 'Delete' && isEditMode && selectedMeasurementId) {
        e.preventDefault();
        if (confirm('Delete this measurement?')) {
          deleteMeasurementMutation.mutate({ id: selectedMeasurementId });
          setSelectedMeasurementId(null);
        }
      }

      // F key to fit canvas to screen
      if (e.key === 'f' || e.key === 'F') {
        // Only trigger if not typing in an input/textarea
        const tag = (e.target as HTMLElement).tagName;
        if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
          e.preventDefault();
          handleFitToScreen();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isDrawing, currentPolygon, isEditMode, selectedMeasurementId, isCountingMode, handleFitToScreen]);

  // Prevent page scrolling with mouse wheel except in sidebar
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      // Check if mouse is over sidebar
      const sidebar = sidebarRef.current;
      if (sidebar) {
        const rect = sidebar.getBoundingClientRect();
        const isOverSidebar = 
          e.clientX >= rect.left &&
          e.clientX <= rect.right &&
          e.clientY >= rect.top &&
          e.clientY <= rect.bottom;
        
        // Allow scrolling in sidebar, prevent everywhere else
        if (!isOverSidebar) {
          e.preventDefault();
        }
      }
    };

    // Use passive: false to allow preventDefault
    window.addEventListener('wheel', handleWheel, { passive: false });
    return () => window.removeEventListener('wheel', handleWheel);
  }, []);

  // ─── Touch event handlers (iPhone / iPad support) ───────────────────────────
  const handleTouchStart = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault(); // prevent page scroll / default browser gestures

    if (e.touches.length === 2) {
      // Pinch-to-zoom: record initial distance and center
      const t0 = e.touches[0];
      const t1 = e.touches[1];
      const dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
      lastTouchDistanceRef.current = dist;
      lastTouchCenterRef.current = {
        x: (t0.clientX + t1.clientX) / 2,
        y: (t0.clientY + t1.clientY) / 2,
      };
      // Cancel any single-finger pan
      touchStartRef.current = null;
      setIsPanning(false);
      return;
    }

    if (e.touches.length === 1) {
      const touch = e.touches[0];
      const canvas = overlayCanvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = touch.clientX - rect.left;
      const y = touch.clientY - rect.top;

      if (isDrawing || isCountingMode) {
        // In drawing/counting mode: single tap will be handled by touchEnd (tap detection)
        touchStartRef.current = { x: touch.clientX, y: touch.clientY };
      } else {
        // Not drawing: start panning
        touchStartRef.current = { x: touch.clientX, y: touch.clientY };
        setIsPanning(true);
        setPanStart({ x: touch.clientX, y: touch.clientY });
      }
    }
  }, [isDrawing, isCountingMode]);

  const handleTouchMove = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();

    if (e.touches.length === 2) {
      // Pinch-to-zoom
      const t0 = e.touches[0];
      const t1 = e.touches[1];
      const newDist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
      const prevDist = lastTouchDistanceRef.current;
      const center = lastTouchCenterRef.current;

      if (prevDist !== null && center !== null) {
        const scaleFactor = newDist / prevDist;
        const canvas = overlayCanvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();

        // Current pinch center in canvas-local coords
        const centerX = center.x - rect.left;
        const centerY = center.y - rect.top;

        setZoomLevel(prev => {
          const newZoom = Math.max(0.1, Math.min(4.0, prev * scaleFactor));
          const zoomRatio = newZoom / prev;
          const canvasX = centerX - panOffset.x;
          const canvasY = centerY - panOffset.y;
          setPanOffset({
            x: centerX - canvasX * zoomRatio,
            y: centerY - canvasY * zoomRatio,
          });
          return newZoom;
        });
      }

      lastTouchDistanceRef.current = newDist;
      const newCenter = { x: (t0.clientX + t1.clientX) / 2, y: (t0.clientY + t1.clientY) / 2 };
      lastTouchCenterRef.current = newCenter;
      return;
    }

    if (e.touches.length === 1) {
      const touch = e.touches[0];
      const canvas = overlayCanvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = touch.clientX - rect.left;
      const y = touch.clientY - rect.top;

      if (isPanning && panStart) {
        const dx = touch.clientX - panStart.x;
        const dy = touch.clientY - panStart.y;
        const newPanTouch = { x: panOffsetRef.current.x + dx, y: panOffsetRef.current.y + dy };
        panOffsetRef.current = newPanTouch;
        setPanOffset(newPanTouch);
        setPanStart({ x: touch.clientX, y: touch.clientY });
      }

      if (isDrawing) {
        setCursorPosition({ x, y });
      }
    }
  }, [isPanning, panStart, panOffset, isDrawing]);

  const handleTouchEnd = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();

    // Reset pinch state when fingers lift
    if (e.touches.length < 2) {
      lastTouchDistanceRef.current = null;
      lastTouchCenterRef.current = null;
    }

    if (e.touches.length === 0) {
      // All fingers lifted
      const changedTouch = e.changedTouches[0];
      const startPos = touchStartRef.current;

      if (startPos) {
        const dx = Math.abs(changedTouch.clientX - startPos.x);
        const dy = Math.abs(changedTouch.clientY - startPos.y);
        const isTap = dx < 10 && dy < 10; // small movement = tap

        if (isTap && (isDrawing || isCountingMode)) {
          // Treat as a canvas click via ref to avoid forward-reference
          const canvas = overlayCanvasRef.current;
          if (canvas && handleCanvasClickRef.current) {
            const rect = canvas.getBoundingClientRect();
            const syntheticEvent = {
              clientX: changedTouch.clientX,
              clientY: changedTouch.clientY,
              button: 0,
            } as React.MouseEvent<HTMLCanvasElement>;
            handleCanvasClickRef.current(syntheticEvent);
          }
        }
      }

      touchStartRef.current = null;
      setIsPanning(false);
      setPanStart(null);
      setCursorPosition(null);
    }
  }, [isDrawing, isCountingMode]);
  // ─────────────────────────────────────────────────────────────────────────────

  // Calculate real-world distance from pixel distance
  // scale represents: 1 inch on PDF = scale feet in real world
  // Note: coordinates are already normalized when stored, so no zoom division needed
  const calculateDistance = (p1: Point, p2: Point) => {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const pixelDistance = Math.sqrt(dx * dx + dy * dy);
    
    // Convert pixel distance to inches (assuming 96 DPI standard)
    const inchDistance = pixelDistance / 96;
    
    // Convert inches to real-world units using scale
    // If scale = 20 and unit = ft, then 1 inch = 20 ft
    return inchDistance * scale;
  };

  // Calculate total length of a polyline (open path - no closing segment)
  const calculatePolylineLength = (points: Point[]) => {
    if (points.length < 2) return 0;
    
    let length = 0;
    for (let i = 0; i < points.length - 1; i++) {
      length += calculateDistance(points[i], points[i + 1]);
    }
    return length;
  };

  // Calculate perimeter for a polygon (closed path - includes closing segment)
  const calculatePerimeter = (points: Point[]) => {
    if (points.length < 2) return 0;
    
    let perimeter = 0;
    for (let i = 0; i < points.length; i++) {
      const p1 = points[i];
      const p2 = points[(i + 1) % points.length]; // Wrap around to first point
      perimeter += calculateDistance(p1, p2);
    }
    return perimeter;
  };

  // Redraw overlay with measurements — RAF-throttled so it fires at most once per animation frame
  const redrawOverlay = useCallback(() => {
    if (rafIdRef.current !== null) return; // already scheduled
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null;
      _doRedrawOverlay();
    });
  }, []);

  const _doRedrawOverlay = () => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw saved measurements (scale coordinates with zoom level)
    measurements?.forEach((measurement) => {
      // Skip hidden categories or individual hidden measurements
      if (hiddenCategories.has(measurement.name) || hiddenMeasurements.has(measurement.id)) return;
      
      const coords = measurement.coordinates as Point[];
      if (coords.length < 1) return; // Need at least 1 coordinate

      // Check measurement type first
      // Wall measurements store height in the count field but are type='line' — exclude them from point detection
      const isWallMeasurement = WALL_CATEGORIES.includes(measurement.name);
      const isPoint = !isWallMeasurement && (measurement.type === 'point' || (measurement.count !== null && measurement.count !== undefined));
      
      // Point measurements need only 1 coordinate, others need at least 2
      if (!isPoint && coords.length < 2) return;

      // Scale coordinates with zoom level
      const scaledCoords = coords.map(p => ({
        x: p.x * zoomLevel,
        y: p.y * zoomLevel
      }));

      const isSelected = isEditMode && selectedMeasurementId === measurement.id;
      // Wall measurements have perimeter set (stores linear footage) but must render as lines, not polygons
      const isLine = !isPoint && (isWallMeasurement || measurement.perimeter === null || measurement.perimeter === undefined);

      if (isPoint) {
        // Draw point marker (small circle with X)
        const point = scaledCoords[0]; // Point measurements have single coordinate
        const markerSize = isSelected ? 12 : 8;
        
        // Draw outer circle
        ctx.beginPath();
        ctx.arc(point.x, point.y, markerSize, 0, Math.PI * 2);
        ctx.fillStyle = measurement.color + (isSelected ? "80" : "60");
        ctx.fill();
        ctx.strokeStyle = isSelected ? "#22c55e" : measurement.color;
        ctx.lineWidth = isSelected ? 3 : 2;
        ctx.stroke();
        
        // Draw X mark inside
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2;
        const offset = markerSize * 0.5;
        ctx.beginPath();
        ctx.moveTo(point.x - offset, point.y - offset);
        ctx.lineTo(point.x + offset, point.y + offset);
        ctx.moveTo(point.x + offset, point.y - offset);
        ctx.lineTo(point.x - offset, point.y + offset);
        ctx.stroke();
      } else if (isLine) {
        // Draw line measurement (polyline - no fill, no closing)
        ctx.strokeStyle = isSelected ? "#22c55e" : measurement.color;
        ctx.lineWidth = isSelected ? 4 : 3;
        ctx.beginPath();
        ctx.moveTo(scaledCoords[0].x, scaledCoords[0].y);
        for (let i = 1; i < scaledCoords.length; i++) {
          ctx.lineTo(scaledCoords[i].x, scaledCoords[i].y);
        }
        ctx.stroke();

        // Draw endpoints and vertices
        scaledCoords.forEach((point, index) => {
          ctx.beginPath();
          ctx.arc(point.x, point.y, isSelected ? 6 : 4, 0, Math.PI * 2);
          ctx.fillStyle = isSelected ? "#22c55e" : measurement.color;
          ctx.fill();
          ctx.strokeStyle = "#fff";
          ctx.lineWidth = 2;
          ctx.stroke();
        });

        // Draw label with total distance at center of polyline — no background box
        const centerX = scaledCoords.reduce((sum, p) => sum + p.x, 0) / scaledCoords.length;
        const centerY = scaledCoords.reduce((sum, p) => sum + p.y, 0) / scaledCoords.length;
        ctx.font = "bold 10px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        // Outline stroke for readability against any background
        ctx.strokeStyle = "rgba(0,0,0,0.85)";
        ctx.lineWidth = 3;
        ctx.lineJoin = "round";
        ctx.strokeText(`${measurement.area} ${scaleUnit}`, centerX, centerY);
        ctx.fillStyle = measurement.color;
        ctx.fillText(`${measurement.area} ${scaleUnit}`, centerX, centerY);
      } else {
        // Draw area measurement (polygon)
        ctx.fillStyle = measurement.color + (isSelected ? "60" : "40");
        ctx.strokeStyle = isSelected ? "#22c55e" : measurement.color;
        ctx.lineWidth = isSelected ? 4 : 2;

        ctx.beginPath();
        ctx.moveTo(scaledCoords[0].x, scaledCoords[0].y);
        scaledCoords.forEach((point) => ctx.lineTo(point.x, point.y));
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Draw vertices for selected measurement
        if (isSelected) {
          scaledCoords.forEach((point, index) => {
            ctx.beginPath();
            ctx.arc(point.x, point.y, 6, 0, Math.PI * 2);
            ctx.fillStyle = "#22c55e";
            ctx.fill();
            ctx.strokeStyle = "#fff";
            ctx.lineWidth = 2;
            ctx.stroke();
          });
        }

        // Draw label with area — no background box, outlined text for readability
        const centerX = scaledCoords.reduce((sum, p) => sum + p.x, 0) / scaledCoords.length;
        const centerY = scaledCoords.reduce((sum, p) => sum + p.y, 0) / scaledCoords.length;
        ctx.textAlign = "center";
        ctx.lineJoin = "round";
        ctx.strokeStyle = "rgba(0,0,0,0.85)";
        ctx.lineWidth = 3;
        ctx.font = "bold 10px sans-serif";
        ctx.textBaseline = "middle";
        ctx.strokeText(measurement.name, centerX, centerY - 7);
        ctx.fillStyle = measurement.color;
        ctx.fillText(measurement.name, centerX, centerY - 7);
        ctx.font = "9px sans-serif";
        ctx.strokeText(`${measurement.area} ${scaleUnit}²`, centerX, centerY + 7);
        ctx.fillStyle = "#fff";
        ctx.fillText(`${measurement.area} ${scaleUnit}²`, centerX, centerY + 7);
      }
    });

    // Draw current polygon with AutoCAD-style lines and measurements
    if (currentPolygon.length > 0) {
      // Scale current polygon points with zoom level
      const scaledPolygon = currentPolygon.map(p => ({
        x: p.x * zoomLevel,
        y: p.y * zoomLevel
      }));

      // Draw lines between points (open polyline - no closing segment)
      ctx.strokeStyle = selectedColor;
      ctx.lineWidth = 2;
      ctx.setLineDash([]);

      // Only draw segments between consecutive points (no wrap-around)
      for (let i = 0; i < scaledPolygon.length - 1; i++) {
        const p1 = scaledPolygon[i];
        const p2 = scaledPolygon[i + 1];
        
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();

        // Draw distance label on each segment
        const distance = calculateDistance(currentPolygon[i], currentPolygon[i + 1]);
        const midX = (p1.x + p2.x) / 2;
        const midY = (p1.y + p2.y) / 2;
        ctx.font = "10px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.lineJoin = "round";
        ctx.strokeStyle = "rgba(0,0,0,0.85)";
        ctx.lineWidth = 3;
        ctx.strokeText(`${distance.toFixed(1)} ${scaleUnit}`, midX, midY);
        ctx.fillStyle = "#fff";
        ctx.fillText(`${distance.toFixed(1)} ${scaleUnit}`, midX, midY);
      }
      // Draw preview line from last point to cursor
      if (cursorPosition && scaledPolygon.length > 0) {
        const lastPoint = scaledPolygon[scaledPolygon.length - 1];
        ctx.strokeStyle = selectedColor;
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(lastPoint.x, lastPoint.y);
        ctx.lineTo(cursorPosition.x, cursorPosition.y);
        ctx.stroke();
        ctx.setLineDash([]);

        // Show distance for preview line (convert scaled coords to normalized)
        const lastPointNormalized = currentPolygon[currentPolygon.length - 1];
        const cursorNormalized = { x: cursorPosition.x / zoomLevel, y: cursorPosition.y / zoomLevel };
        const distance = calculateDistance(lastPointNormalized, cursorNormalized);
        const midX = (lastPoint.x + cursorPosition.x) / 2;
        const midY = (lastPoint.y + cursorPosition.y) / 2;
        ctx.font = "10px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.lineJoin = "round";
        ctx.strokeStyle = "rgba(0,0,0,0.85)";
        ctx.lineWidth = 3;
        ctx.strokeText(`${distance.toFixed(1)} ${scaleUnit}`, midX, midY);
        ctx.fillStyle = "#fff";
        ctx.fillText(`${distance.toFixed(1)} ${scaleUnit}`, midX, midY);
      }

      // Draw points
      scaledPolygon.forEach((point, index) => {
        ctx.beginPath();
        ctx.arc(point.x, point.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = "#fff";
        ctx.fill();
        ctx.strokeStyle = selectedColor;
        ctx.lineWidth = 2;
        ctx.stroke();
      });

      // Area preview removed - users must explicitly close shape to create area
    }

    // Draw calibration line
    if (isCalibrating && calibrationPoints.length > 0) {
      const scaledPoints = calibrationPoints.map(p => ({
        x: p.x * zoomLevel,
        y: p.y * zoomLevel
      }));

      // Draw points
      scaledPoints.forEach(point => {
        ctx.beginPath();
        ctx.arc(point.x, point.y, 8, 0, Math.PI * 2);
        ctx.fillStyle = "#3b82f6";
        ctx.fill();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2;
        ctx.stroke();
      });

      // Draw line between points or to cursor
      if (scaledPoints.length === 1 && cursorPosition) {
        ctx.strokeStyle = "#3b82f6";
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(scaledPoints[0].x, scaledPoints[0].y);
        ctx.lineTo(cursorPosition.x, cursorPosition.y);
        ctx.stroke();
        ctx.setLineDash([]);

        // Show distance (use normalized coordinates)
        const cursorNormalized = { x: cursorPosition.x / zoomLevel, y: cursorPosition.y / zoomLevel };
        const distance = calculateDistance(calibrationPoints[0], cursorNormalized);
        const midX = (scaledPoints[0].x + cursorPosition.x) / 2;
        const midY = (scaledPoints[0].y + cursorPosition.y) / 2;
        ctx.fillStyle = "rgba(59, 130, 246, 0.9)";
        ctx.fillRect(midX - 40, midY - 15, 80, 25);
        ctx.fillStyle = "#fff";
        ctx.font = "bold 12px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(`${distance.toFixed(1)} ${scaleUnit}`, midX, midY);
      } else if (scaledPoints.length === 2) {
        ctx.strokeStyle = "#3b82f6";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(scaledPoints[0].x, scaledPoints[0].y);
        ctx.lineTo(scaledPoints[1].x, scaledPoints[1].y);
        ctx.stroke();
      }
    }

    // Draw text annotations
    textAnnotationsList.forEach((ann) => {
      if (ann.pageNumber !== currentPage) return;
      // Coordinates stored in baseScale pixel space — scale by zoomLevel for display
      const sx = ann.x * zoomLevel;
      const sy = ann.y * zoomLevel;
      const sw = ann.width * zoomLevel;
      const sh = ann.height * zoomLevel;
      const isSelected = selectedTextId === ann.id;

      // Background
      ctx.fillStyle = ann.bgColor === 'transparent' ? 'rgba(255,255,255,0.85)' : ann.bgColor;
      ctx.fillRect(sx, sy, sw, sh);

      // Border
      ctx.strokeStyle = isSelected ? '#3b82f6' : '#374151';
      ctx.lineWidth = isSelected ? 2.5 : 1.5;
      ctx.strokeRect(sx, sy, sw, sh);

      // Text content — word-wrap inside box
      const padding = 8 * zoomLevel;
      const fontSize = Math.max(8, ann.fontSize * zoomLevel);
      ctx.fillStyle = ann.textColor;
      ctx.font = `${fontSize}px sans-serif`;
      ctx.textBaseline = 'top';
      ctx.textAlign = 'left';
      // Simple single-line clipped text (full wrap would need more logic)
      ctx.save();
      ctx.beginPath();
      ctx.rect(sx + padding, sy + padding, sw - padding * 2, sh - padding * 2);
      ctx.clip();
      // Multi-line word wrap
      const words = ann.content.split(' ');
      let line = '';
      let lineY = sy + padding;
      const lineHeight = fontSize * 1.3;
      for (const word of words) {
        const testLine = line ? line + ' ' + word : word;
        const metrics = ctx.measureText(testLine);
        if (metrics.width > sw - padding * 2 && line) {
          ctx.fillText(line, sx + padding, lineY);
          line = word;
          lineY += lineHeight;
          if (lineY + lineHeight > sy + sh) break;
        } else {
          line = testLine;
        }
      }
      if (line) ctx.fillText(line, sx + padding, lineY);
      ctx.restore();

      // Resize handle (bottom-right corner) — only when selected or in text mode
      if (isSelected || isTextMode) {
        const hSize = Math.max(10, 12 * zoomLevel);
        ctx.fillStyle = '#3b82f6';
        ctx.fillRect(sx + sw - hSize, sy + sh - hSize, hSize, hSize);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(sx + sw - hSize, sy + sh - hSize, hSize, hSize);
      }
    });

    // Draw crosshair cursor
    if (isDrawing && cursorPosition) {
      // Check if cursor is near a snap point
      const snapPoint = findSnapPoint(cursorPosition.x, cursorPosition.y);
      const isNearSnapPoint = snapPoint !== null;

      ctx.strokeStyle = isNearSnapPoint ? "rgba(34, 197, 94, 0.9)" : "rgba(0, 0, 0, 0.8)";
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      
      // Horizontal line
      ctx.beginPath();
      ctx.moveTo(0, cursorPosition.y);
      ctx.lineTo(canvas.width, cursorPosition.y);
      ctx.stroke();
      
      // Vertical line
      ctx.beginPath();
      ctx.moveTo(cursorPosition.x, 0);
      ctx.lineTo(cursorPosition.x, canvas.height);
      ctx.stroke();
      
      // Center circle - larger and highlighted when near snap point
      ctx.beginPath();
      ctx.arc(cursorPosition.x, cursorPosition.y, isNearSnapPoint ? 12 : 8, 0, Math.PI * 2);
      ctx.lineWidth = isNearSnapPoint ? 2 : 1;
      ctx.stroke();

      // Draw snap indicator
      if (isNearSnapPoint && snapPoint) {
        const scaledSnapPoint = { x: snapPoint.x * zoomLevel, y: snapPoint.y * zoomLevel };
        ctx.strokeStyle = "rgba(34, 197, 94, 0.9)";
        ctx.fillStyle = "rgba(34, 197, 94, 0.3)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(scaledSnapPoint.x, scaledSnapPoint.y, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
  };

  // Redraw when data or view state changes (NOT on every cursor move — that is handled via RAF in mousemove)
  useEffect(() => {
    redrawOverlay();
  }, [measurements, currentPolygon, selectedColor, scale, scaleUnit, zoomLevel, isEditMode, selectedMeasurementId, draggingVertexIndex, isCalibrating, calibrationPoints, hiddenCategories, hiddenMeasurements, textAnnotationsList, selectedTextId, isTextMode, currentPage]);

  // Cursor-move redraws — only when actively drawing/counting (cheap path)
  useEffect(() => {
    if (cursorPosition && (isDrawing || isCountingMode || isCalibrating)) {
      redrawOverlay();
    }
  }, [cursorPosition]);

  // Delete selected text annotation with Delete/Backspace key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedTextId !== null && editingTextId === null) {
        // Don't delete if focus is in an input/textarea
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        deleteTextAnnotationMutation.mutate({ id: selectedTextId, projectId });
        setSelectedTextId(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedTextId, editingTextId, projectId]);

  // Zoom toward the center of the visible canvas area (used by +/- toolbar buttons)
  const zoomTowardCenter = useCallback((delta: number) => {
    const currentZoom = zoomLevelRef.current;
    const currentPan = panOffsetRef.current;
    const newZoom = Math.max(0.1, Math.min(4.0, currentZoom + delta));
    if (newZoom === currentZoom) return;
    const container = containerRef.current;
    if (!container) {
      setZoomLevel(newZoom);
      return;
    }
    // Zoom toward the center of the visible container
    const cx = container.clientWidth / 2;
    const cy = container.clientHeight / 2;
    const pdfX = (cx - currentPan.x) / currentZoom;
    const pdfY = (cy - currentPan.y) / currentZoom;
    const newPanX = cx - pdfX * newZoom;
    const newPanY = cy - pdfY * newZoom;
    zoomLevelRef.current = newZoom;
    panOffsetRef.current = { x: newPanX, y: newPanY };
    setZoomLevel(newZoom);
    setPanOffset({ x: newPanX, y: newPanY });
  }, []);

  const handleZoomIn = useCallback(() => zoomTowardCenter(0.1), [zoomTowardCenter]);
  const handleZoomOut = useCallback(() => zoomTowardCenter(-0.1), [zoomTowardCenter]);

  const handleZoomReset = () => {
    setZoomLevel(1.0);
    setPanOffset({ x: 0, y: 0 });
  };

  // Handle mouse wheel zoom - zoom to cursor position
  // Uses refs to avoid stale closure issues with rapid scroll events
  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    e.stopPropagation();

    const currentZoom = zoomLevelRef.current;
    const currentPan = panOffsetRef.current;

    // Multiplicative zoom for smooth, natural feel (same as Google Maps / Figma)
    // Scale factor: 1.05 per scroll tick, clamped to avoid jumps on fast trackpads
    const rawDelta = Math.abs(e.deltaY);
    const factor = e.deltaY > 0
      ? 1 / (1 + Math.min(rawDelta, 100) * 0.001)  // zoom out
      : 1 + Math.min(rawDelta, 100) * 0.001;        // zoom in
    const newZoom = Math.max(0.1, Math.min(4.0, currentZoom * factor));
    if (newZoom === currentZoom) return;

    // Get the container element's bounding rect (the div that wraps the canvas)
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();

    // Mouse position relative to the container's top-left corner
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // The point on the PDF that is currently under the mouse cursor.
    // The canvas is positioned at (currentPan.x, currentPan.y) inside the container.
    // So the PDF point under the cursor (in canvas pixel space) is:
    const pdfX = (mouseX - currentPan.x) / currentZoom;
    const pdfY = (mouseY - currentPan.y) / currentZoom;

    // After applying newZoom, we want pdfX/pdfY to still be under the mouse.
    // So: mouseX = pdfX * newZoom + newPanX  →  newPanX = mouseX - pdfX * newZoom
    const newPanX = mouseX - pdfX * newZoom;
    const newPanY = mouseY - pdfY * newZoom;

    // Update both refs immediately so rapid scroll events see fresh values
    zoomLevelRef.current = newZoom;
    panOffsetRef.current = { x: newPanX, y: newPanY };

    setZoomLevel(newZoom);
    setPanOffset({ x: newPanX, y: newPanY });
  };

  // Handle mouse down for panning, drawing, or vertex dragging
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = overlayCanvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Middle mouse button (button 1) always pans, regardless of mode
    if (e.button === 1) {
      e.preventDefault();
      setIsPanning(true);
      setPanStart({ x: e.clientX, y: e.clientY });
      return;
    }

    // Text mode: check for resize handle or drag on existing text boxes
    if (isTextMode || selectedTextId !== null) {
      const normalizedX = x / zoomLevel;
      const normalizedY = y / zoomLevel;
      // Check resize handle first (bottom-right 16px corner)
      const HANDLE = 16;
      const resizeTarget = textAnnotationsList.find((ann) => {
        if (ann.pageNumber !== currentPage) return false;
        const rx = ann.x + ann.width - HANDLE;
        const ry = ann.y + ann.height - HANDLE;
        return normalizedX >= rx && normalizedX <= ann.x + ann.width &&
               normalizedY >= ry && normalizedY <= ann.y + ann.height;
      });
      if (resizeTarget) {
        setResizingTextId(resizeTarget.id);
        setTextResizeStart({ mouseX: x, mouseY: y, origW: resizeTarget.width, origH: resizeTarget.height });
        setSelectedTextId(resizeTarget.id);
        return;
      }
      // Check drag (anywhere inside the box)
      const dragTarget = textAnnotationsList.find((ann) => {
        if (ann.pageNumber !== currentPage) return false;
        return normalizedX >= ann.x && normalizedX <= ann.x + ann.width &&
               normalizedY >= ann.y && normalizedY <= ann.y + ann.height;
      });
      if (dragTarget) {
        setDraggingTextId(dragTarget.id);
        setTextDragStart({ mouseX: x, mouseY: y, origX: dragTarget.x, origY: dragTarget.y });
        setSelectedTextId(dragTarget.id);
        return;
      }
      // Clicked on empty area — deselect
      if (!isTextMode) setSelectedTextId(null);
    }

    // Edit mode: check if clicking on a vertex
    if (isEditMode && selectedMeasurementId && measurements) {
      const selectedMeasurement = measurements.find(m => m.id === selectedMeasurementId);
      if (selectedMeasurement) {
        const coords = selectedMeasurement.coordinates as Point[];
        const scaledCoords = coords.map(p => ({ x: p.x * zoomLevel, y: p.y * zoomLevel }));
        
        // Check if clicking near any vertex
        for (let i = 0; i < scaledCoords.length; i++) {
          const distance = Math.sqrt(
            Math.pow(x - scaledCoords[i].x, 2) + Math.pow(y - scaledCoords[i].y, 2)
          );
          if (distance < 10) {
            setDraggingVertexIndex(i);
            return;
          }
        }
      }
    }

    if (!isDrawing && !isEditMode) {
      // Start panning mode
      setIsPanning(true);
      setPanStart({ x: e.clientX, y: e.clientY });
      return;
    }
  };

  // Handle mouse up
  const handleMouseUp = () => {
    // Save text annotation position/size on mouse up
    if (draggingTextId !== null && textDragStart) {
      const ann = textAnnotationsList.find(a => a.id === draggingTextId);
      if (ann) {
        updateTextAnnotationMutation.mutate({ id: draggingTextId, projectId, x: ann.x, y: ann.y });
      }
      setDraggingTextId(null);
      setTextDragStart(null);
      return;
    }
    if (resizingTextId !== null && textResizeStart) {
      const ann = textAnnotationsList.find(a => a.id === resizingTextId);
      if (ann) {
        updateTextAnnotationMutation.mutate({ id: resizingTextId, projectId, width: ann.width, height: ann.height });
      }
      setResizingTextId(null);
      setTextResizeStart(null);
      return;
    }

    if (draggingVertexIndex !== null && selectedMeasurementId && measurements) {
      // Save the updated measurement
      const selectedMeasurement = measurements.find(m => m.id === selectedMeasurementId);
      if (selectedMeasurement) {
        const coords = selectedMeasurement.coordinates as Point[];
        const area = calculateArea(coords);
        updateMeasurementMutation.mutate({
          id: selectedMeasurementId,
          area: area.toFixed(2),
          coordinates: coords,
        });
      }
    }
    
    setIsPanning(false);
    setPanStart(null);
    setDraggingVertexIndex(null);
  };

  // Check if point is inside polygon using ray casting algorithm
  const isPointInPolygon = (point: Point, polygon: Point[]): boolean => {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].x, yi = polygon[i].y;
      const xj = polygon[j].x, yj = polygon[j].y;
      
      const intersect = ((yi > point.y) !== (yj > point.y))
        && (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  };

  // Find nearest snap point from existing measurements
  const findSnapPoint = (x: number, y: number, snapDistance: number = 15): Point | null => {
    if (!measurements) return null;
    
    // Check all existing measurement vertices
    for (const measurement of measurements) {
      const coords = measurement.coordinates as Point[];
      for (const point of coords) {
        const scaledPoint = { x: point.x * zoomLevel, y: point.y * zoomLevel };
        const distance = Math.sqrt(
          Math.pow(x - scaledPoint.x, 2) + Math.pow(y - scaledPoint.y, 2)
        );
        
        if (distance < snapDistance) {
          return point; // Return normalized point
        }
      }
    }
    
    return null;
  };

  // Handle canvas click for drawing and editing
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = overlayCanvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Text mode: place a new text annotation on click
    if (isTextMode) {
      const normalizedX = x / zoomLevel;
      const normalizedY = y / zoomLevel;
      // Check if clicking on an existing text box to select it
      const clicked = textAnnotationsList.find((ann) => {
        if (ann.pageNumber !== currentPage) return false;
        return normalizedX >= ann.x && normalizedX <= ann.x + ann.width &&
               normalizedY >= ann.y && normalizedY <= ann.y + ann.height;
      });
      if (clicked) {
        setSelectedTextId(clicked.id);
        return;
      }
      // No existing box clicked — create a new one
      createTextAnnotationMutation.mutate({
        projectId,
        pageNumber: currentPage,
        x: normalizedX,
        y: normalizedY,
        width: 200,
        height: 80,
        content: 'Text',
        fontSize: 24,
        textColor: '#000000',
        bgColor: '#ffffff',
      }, {
        onSuccess: (data) => {
          setSelectedTextId(data.id);
          // Immediately open inline editor
          setEditingTextId(data.id);
          setEditingTextValue('Text');
        }
      });
      return;
    }

    // Calibration mode: collect two points
    if (isCalibrating) {
      const normalizedX = x / zoomLevel;
      const normalizedY = y / zoomLevel;
      const newPoints = [...calibrationPoints, { x: normalizedX, y: normalizedY }];
      setCalibrationPoints(newPoints);
      
      // After two points, open dialog to enter known distance
      if (newPoints.length === 2) {
        setIsCalibrationDialogOpen(true);
      }
      return;
    }

    // Edit mode: select measurement
    if (isEditMode) {
      const normalizedX = x / zoomLevel;
      const normalizedY = y / zoomLevel;
      
      // Check if clicking on any measurement
      if (measurements) {
        for (const measurement of measurements) {
          const coords = measurement.coordinates as Point[];
          // Check if point is inside polygon
          if (isPointInPolygon({ x: normalizedX, y: normalizedY }, coords)) {
            setSelectedMeasurementId(measurement.id);
            return;
          }
        }
      }
      setSelectedMeasurementId(null);
      return;
    }

    if (!isDrawing) return;

    // Point counting mode: ONLY use isCountingMode state (set exclusively by Count button)
    // Draw button should always draw shapes/lines, never count
    const isPointCountingMode = isCountingMode;
    if (isPointCountingMode) {
      const normalizedX = x / zoomLevel;
      const normalizedY = y / zoomLevel;
      const point = { x: normalizedX, y: normalizedY };
      
      // Immediately save this point as a measurement
      const categoryName = selectedCategory || measurementName;
      createMeasurementMutation.mutate({
        projectId,
        name: categoryName,
        type: 'point',
        color: selectedColor,
        area: '0', // Not used for points
        perimeter: undefined,
        count: 1,
        coordinates: [point],
      });
      
      toast.success(`Added ${categoryName} marker`);
      return;
    }

    // Check if clicking near the first point to auto-close shape
    if (currentPolygon.length >= 3) {
      const firstPoint = currentPolygon[0];
      const firstPointScaled = { x: firstPoint.x * zoomLevel, y: firstPoint.y * zoomLevel };
      const distance = Math.sqrt(
        Math.pow(x - firstPointScaled.x, 2) + Math.pow(y - firstPointScaled.y, 2)
      );
      
      // If clicking within 15 pixels of first point, auto-close and save
      if (distance < 15) {
        setIsShapeClosed(true); // Mark as explicitly closed for area calculation
        // Reset category selection to default
        setSelectedCategory("Drip Edge");
        setMeasurementName("Drip Edge");
        setIsCustomCategory(false);
        setIsNameDialogOpen(true);
        return;
      }
    }

    // Exact measurement mode: create line of specific length
    if (isExactMode && exactDistance && currentPolygon.length === 1) {
      const startPoint = currentPolygon[0];
      
      // Normalize cursor position to match stored coordinates
      const normalizedX = x / zoomLevel;
      const normalizedY = y / zoomLevel;
      
      // Calculate angle from start point to cursor (both in normalized space)
      const angle = Math.atan2(normalizedY - startPoint.y, normalizedX - startPoint.x);
      
      // Calculate end point at exact distance in normalized space
      // Convert real-world distance to pixels: distance (ft) / scale (ft/inch) = inches, then inches * 96 = pixels
      const distanceInInches = parseFloat(exactDistance) / scale;
      const distanceInPixels = distanceInInches * 96;
      const endX = startPoint.x + (distanceInPixels * Math.cos(angle));
      const endY = startPoint.y + (distanceInPixels * Math.sin(angle));
      
      setCurrentPolygon([...currentPolygon, { x: endX, y: endY }]);
      return;
    }

    // Check for snap to existing measurement points
    const snapPoint = findSnapPoint(x, y);
    if (snapPoint) {
      setCurrentPolygon([...currentPolygon, snapPoint]);
      return;
    }

    // Store coordinates normalized by zoom level so they stay in the same place
    const normalizedX = x / zoomLevel;
    const normalizedY = y / zoomLevel;
    setCurrentPolygon([...currentPolygon, { x: normalizedX, y: normalizedY }]);
  };
  // Keep ref in sync for touch handlers
  handleCanvasClickRef.current = handleCanvasClick;

  // Complete polygon
  const completePolygon = () => {
    if (currentPolygon.length < 3) {
      toast.error("Need at least 3 points to create a measurement");
      return;
    }
    setIsNameDialogOpen(true);
  };

  // Calculate polygon area using Shoelace formula
  const calculateArea = (points: Point[]): number => {
    let area = 0;
    for (let i = 0; i < points.length; i++) {
      const j = (i + 1) % points.length;
      area += points[i].x * points[j].y;
      area -= points[j].x * points[i].y;
    }
    // Get pixel area
    const pixelArea = Math.abs(area / 2);
    
    // Convert pixel area to inch area (assuming 96 DPI)
    const inchArea = pixelArea / (96 * 96);
    
    // Convert inch area to real-world area using scale
    // If scale = 20 and unit = ft, then 1 inch = 20 ft, so 1 inch² = 400 ft²
    return inchArea * scale * scale;
  };

  // Save measurement
  const saveMeasurement = async () => {
    if (!measurementName.trim()) {
      toast.error("Please enter a name for this measurement");
      return;
    }

    // If a custom category name was entered, persist it to the DB so it
    // appears in all future projects for this user.
    if (isCustomCategory && measurementName.trim()) {
      try {
        await createCategoryMutation.mutateAsync({ name: measurementName.trim() });
        await utils.countingCategories.list.invalidate();
      } catch {
        // Non-fatal: category may already exist (duplicate guard on server).
        // Continue saving the measurement regardless.
      }
    }

    // Determine if this is a line or area measurement
    // Line: 2 points OR shape not explicitly closed (Escape key)
    // Area: 3+ points AND shape explicitly closed (clicked first point)
    let area: number;
    let perimeter: number | undefined;
    let type: 'area' | 'line' | 'point';
    
    if (currentPolygon.length === 2 || !isShapeClosed) {
      // Line measurement: calculate total polyline length (open path)
      area = calculatePolylineLength(currentPolygon);
      perimeter = undefined;
      type = 'line';
    } else {
      // Area measurement: calculate area and perimeter
      area = calculateArea(currentPolygon);
      perimeter = calculatePerimeter(currentPolygon);
      type = 'area';
    }

    // If this is a Wall category, intercept and ask for height
    const categoryName = isCustomCategory ? measurementName : selectedCategory;
    if (WALL_CATEGORIES.includes(categoryName)) {
      const linearFt = calculatePolylineLength(currentPolygon);
      setPendingWallMeasurement({
        name: measurementName,
        color: selectedColor,
        linearFt,
        coordinates: currentPolygon,
      });
      setWallHeight("");
      setIsNameDialogOpen(false);
      setIsWallHeightDialogOpen(true);
      return;
    }

    createMeasurementMutation.mutate({
      projectId,
      name: measurementName,
      type,
      color: selectedColor,
      area: area.toFixed(2),
      perimeter: perimeter ? perimeter.toFixed(2) : undefined,
      coordinates: currentPolygon,
    });
    setIsNameDialogOpen(false);
  };

  const saveWallMeasurement = () => {
    if (!pendingWallMeasurement) return;
    const height = parseFloat(wallHeight);
    if (isNaN(height) || height <= 0) {
      toast.error("Please enter a valid wall height");
      return;
    }
    const wallArea = pendingWallMeasurement.linearFt * height;
    // Store linearFt in perimeter field, wallArea in area field, height in a note via name
    createMeasurementMutation.mutate({
      projectId,
      name: pendingWallMeasurement.name,
      type: 'line',
      color: pendingWallMeasurement.color,
      area: wallArea.toFixed(2),           // wall area = linear ft × height
      perimeter: pendingWallMeasurement.linearFt.toFixed(2), // linear ft stored in perimeter
      coordinates: pendingWallMeasurement.coordinates,
      count: Math.round(height * 1000),      // store height × 1000 as integer in count field (3 decimal places)
    });
    setIsWallHeightDialogOpen(false);
    setPendingWallMeasurement(null);
    setWallHeight("");
    setIsShapeClosed(false);
    setCurrentPolygon([]);  // Clear the drawn line immediately so it doesn't linger on canvas
    // isDrawing will be reset by createMeasurementMutation.onSuccess
  };
  // Export measurements to PDF
  const exportMeasurementsPDF = async () => {
    if (!measurements || measurements.length === 0) {
      toast.error("No measurements to export");
      return;
    }

    // Group measurements by category
    const grouped = measurements.reduce((acc, m) => {
      if (!acc[m.name]) acc[m.name] = [];
      acc[m.name].push(m);
      return acc;
    }, {} as Record<string, typeof measurements>);

    // Create PDF
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 20;
    let yPos = 25;

    // Header
    doc.setFontSize(20);
    doc.setFont("helvetica", "bold");
    doc.text(project?.name || "Roof Plan Measurements", margin, yPos);
    
    yPos += 10;
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100, 100, 100);
    doc.text(new Date().toLocaleDateString(), margin, yPos);
    
    yPos += 15;
    doc.setTextColor(0, 0, 0);

      // Categories
      Object.entries(grouped).forEach(([categoryName, items]) => {
        // Check if this is a Wall category
        const isWallCat = WALL_CATEGORIES.includes(categoryName);

        // Calculate totals
        const pointItems = items.filter(m => m.type === 'point' || (m.count !== null && m.count !== undefined && m.type !== 'line'));
        const lineItems = !isWallCat ? items.filter(m => m.type !== 'point' && (m.perimeter === null || m.perimeter === undefined)) : [];
        const areaItems = !isWallCat ? items.filter(m => m.type !== 'point' && m.perimeter !== null && m.perimeter !== undefined) : [];
        
        const totalCount = pointItems.length;
        const totalLinearFt = lineItems.reduce((sum, m) => sum + parseFloat(m.area || '0'), 0);
        const totalAreaSqFt = areaItems.reduce((sum, m) => sum + parseFloat(m.area || '0'), 0);

        // Wall totals
        const totalWallLinearFt = isWallCat ? items.reduce((sum, m) => sum + parseFloat(m.perimeter || '0'), 0) : 0;
        const totalWallArea = isWallCat ? items.reduce((sum, m) => sum + parseFloat(m.area || '0'), 0) : 0;

        // Check if we need a new page
        if (yPos > 270) {
          doc.addPage();
          yPos = 25;
        }

        // Category name
        doc.setFontSize(14);
        doc.setFont("helvetica", "bold");
        doc.text(categoryName, margin, yPos);
        yPos += 8;

        // Totals
        doc.setFontSize(11);
        doc.setFont("helvetica", "normal");
        
        if (isWallCat) {
          // Wall: show linear footage, per-item height, and total area
          doc.text(`Total Linear: ${totalWallLinearFt.toFixed(2)} ${scaleUnit}`, margin + 5, yPos);
          yPos += 7;
          doc.text(`Total Wall Area: ${totalWallArea.toFixed(2)} ${scaleUnit}\u00b2`, margin + 5, yPos);
          yPos += 7;
          // Per-item breakdown
          items.forEach((m, idx) => {
            if (yPos > 270) { doc.addPage(); yPos = 25; }
            const height = m.count != null ? (m.count / 1000).toFixed(2) : '?';
            doc.setFontSize(9);
            doc.setFont("helvetica", "normal");
            doc.setTextColor(80, 80, 80);
            doc.text(
              `  Segment ${idx + 1}: ${m.perimeter} ${scaleUnit} \u00d7 ${height} ${scaleUnit} h = ${m.area} ${scaleUnit}\u00b2`,
              margin + 5, yPos
            );
            doc.setTextColor(0, 0, 0);
            yPos += 6;
          });
        } else {
          if (totalCount > 0) {
            doc.text(`Count: ${totalCount} item${totalCount === 1 ? '' : 's'}`, margin + 5, yPos);
            yPos += 7;
          }
          
          if (totalLinearFt > 0) {
            doc.text(`Total: ${totalLinearFt.toFixed(2)} ${scaleUnit}`, margin + 5, yPos);
            yPos += 7;
          }
          
          if (totalAreaSqFt > 0) {
            doc.text(`Total: ${totalAreaSqFt.toFixed(2)} ${scaleUnit}\u00b2`, margin + 5, yPos);
            yPos += 7;
          }
        }

        yPos += 8;
      });

    // ── Annotated Plan Pages: one page per measurement category ──────────────
    // Each category gets its own PDF page showing only that category's shapes
    // on the roof plan, so labels never overlap across categories.
    if (pdfDoc && measurements && measurements.length > 0) {
      try {
        const EXPORT_SCALE = baseScale; // 2.5 — matches stored coordinate space

        // Render the base PDF page once; we'll clone it for each category.
        const page = await pdfDoc.getPage(currentPage);
        const viewport = page.getViewport({ scale: EXPORT_SCALE });

        // Helper: render the base plan to a fresh canvas
        const renderBasePlan = async (): Promise<HTMLCanvasElement> => {
          const c = document.createElement('canvas');
          c.width = viewport.width;
          c.height = viewport.height;
          const ctx2d = c.getContext('2d')!;
          ctx2d.imageSmoothingEnabled = true;
          ctx2d.imageSmoothingQuality = 'high';
          await page.render({ canvasContext: ctx2d, viewport, canvas: c }).promise;
          return c;
        };

        // Helper: draw a single measurement onto a canvas context
        const drawMeasurement = (planCtx: CanvasRenderingContext2D, m: typeof measurements[0]) => {
          const coords = m.coordinates as Point[];
          if (coords.length < 1) return;
          const isWallMeasurement = m.type === 'line' && m.perimeter !== null && m.perimeter !== undefined && m.count !== null && m.count !== undefined;
          const isPoint = m.type === 'point' || (!isWallMeasurement && m.count !== null && m.count !== undefined);
          if (!isPoint && coords.length < 2) return;
          const sc = coords.map(p => ({ x: p.x, y: p.y }));
          // isLine: a polyline (linear ft) — has perimeter but NOT the wall-height count trick
          const isLine = !isPoint && !isWallMeasurement && (m.perimeter !== null && m.perimeter !== undefined);

          if (isPoint) {
            const markerSize = 30;
            const pt = sc[0];
            planCtx.beginPath();
            planCtx.arc(pt.x, pt.y, markerSize, 0, Math.PI * 2);
            planCtx.fillStyle = m.color + '60';
            planCtx.fill();
            planCtx.strokeStyle = m.color;
            planCtx.lineWidth = 4;
            planCtx.stroke();
            planCtx.strokeStyle = '#fff';
            planCtx.lineWidth = 4;
            const xOff = markerSize * 0.55;
            planCtx.beginPath();
            planCtx.moveTo(pt.x - xOff, pt.y - xOff);
            planCtx.lineTo(pt.x + xOff, pt.y + xOff);
            planCtx.moveTo(pt.x + xOff, pt.y - xOff);
            planCtx.lineTo(pt.x - xOff, pt.y + xOff);
            planCtx.stroke();
            const lx = pt.x + markerSize + 10;
            const ly = pt.y;
            planCtx.textAlign = 'left';
            planCtx.textBaseline = 'middle';
            planCtx.lineJoin = 'round';
            planCtx.font = 'bold 22px sans-serif';
            planCtx.strokeStyle = 'rgba(0,0,0,0.9)';
            planCtx.lineWidth = 5;
            planCtx.strokeText(`#${m.count ?? 1}`, lx, ly);
            planCtx.fillStyle = '#fff';
            planCtx.fillText(`#${m.count ?? 1}`, lx, ly);
          } else if (isWallMeasurement) {
            // Wall: draw as a thick colored polyline with wall-area label
            planCtx.strokeStyle = m.color;
            planCtx.lineWidth = 8;
            planCtx.beginPath();
            planCtx.moveTo(sc[0].x, sc[0].y);
            for (let i = 1; i < sc.length; i++) planCtx.lineTo(sc[i].x, sc[i].y);
            planCtx.stroke();
            sc.forEach(pt => {
              planCtx.beginPath();
              planCtx.arc(pt.x, pt.y, 10, 0, Math.PI * 2);
              planCtx.fillStyle = m.color;
              planCtx.fill();
              planCtx.strokeStyle = '#fff';
              planCtx.lineWidth = 3;
              planCtx.stroke();
            });
            const cx = sc.reduce((s, p) => s + p.x, 0) / sc.length;
            const cy = sc.reduce((s, p) => s + p.y, 0) / sc.length;
            const wallHeight = (m.count ?? 0) / 1000;
            planCtx.textAlign = 'center';
            planCtx.textBaseline = 'middle';
            planCtx.lineJoin = 'round';
            planCtx.lineWidth = 5;
            planCtx.strokeStyle = 'rgba(0,0,0,0.9)';
            planCtx.font = '18px sans-serif';
            planCtx.strokeText(`${m.perimeter} ${scaleUnit} \u00d7 ${wallHeight.toFixed(2)} ${scaleUnit} h`, cx, cy - 10);
            planCtx.fillStyle = '#fff';
            planCtx.fillText(`${m.perimeter} ${scaleUnit} \u00d7 ${wallHeight.toFixed(2)} ${scaleUnit} h`, cx, cy - 10);
            planCtx.strokeText(`= ${m.area} ${scaleUnit}\u00b2`, cx, cy + 14);
            planCtx.fillStyle = m.color;
            planCtx.fillText(`= ${m.area} ${scaleUnit}\u00b2`, cx, cy + 14);
          } else if (isLine) {
            planCtx.strokeStyle = m.color;
            planCtx.lineWidth = 6;
            planCtx.beginPath();
            planCtx.moveTo(sc[0].x, sc[0].y);
            for (let i = 1; i < sc.length; i++) planCtx.lineTo(sc[i].x, sc[i].y);
            planCtx.stroke();
            sc.forEach(pt => {
              planCtx.beginPath();
              planCtx.arc(pt.x, pt.y, 10, 0, Math.PI * 2);
              planCtx.fillStyle = m.color;
              planCtx.fill();
              planCtx.strokeStyle = '#fff';
              planCtx.lineWidth = 3;
              planCtx.stroke();
            });
            const cx = sc.reduce((s, p) => s + p.x, 0) / sc.length;
            const cy = sc.reduce((s, p) => s + p.y, 0) / sc.length;
            planCtx.textAlign = 'center';
            planCtx.textBaseline = 'middle';
            planCtx.lineJoin = 'round';
            planCtx.lineWidth = 5;
            planCtx.strokeStyle = 'rgba(0,0,0,0.9)';
            planCtx.font = 'bold 20px sans-serif';
            planCtx.strokeText(`${m.perimeter} ${scaleUnit}`, cx, cy);
            planCtx.fillStyle = '#fff';
            planCtx.fillText(`${m.perimeter} ${scaleUnit}`, cx, cy);
          } else {
            // Area polygon
            planCtx.fillStyle = m.color + '40';
            planCtx.strokeStyle = m.color;
            planCtx.lineWidth = 4;
            planCtx.beginPath();
            planCtx.moveTo(sc[0].x, sc[0].y);
            sc.forEach(pt => planCtx.lineTo(pt.x, pt.y));
            planCtx.closePath();
            planCtx.fill();
            planCtx.stroke();
            const cx = sc.reduce((s, p) => s + p.x, 0) / sc.length;
            const cy = sc.reduce((s, p) => s + p.y, 0) / sc.length;
            planCtx.textAlign = 'center';
            planCtx.textBaseline = 'middle';
            planCtx.lineJoin = 'round';
            planCtx.lineWidth = 5;
            planCtx.strokeStyle = 'rgba(0,0,0,0.9)';
            planCtx.font = 'bold 20px sans-serif';
            planCtx.strokeText(`${m.area} ${scaleUnit}\u00b2`, cx, cy);
            planCtx.fillStyle = '#fff';
            planCtx.fillText(`${m.area} ${scaleUnit}\u00b2`, cx, cy);
          }
        };
        // Helper: draw text annotations onto a canvas context
        const drawTextAnnotations = (planCtx: CanvasRenderingContext2D) => {
          const pageTextAnnotations = textAnnotationsList.filter(a => a.pageNumber === currentPage);
          pageTextAnnotations.forEach((ann) => {
            const { x, y, width, height, content, fontSize, textColor, bgColor } = ann;
            planCtx.fillStyle = bgColor === 'transparent' ? 'rgba(255,255,255,0.9)' : bgColor;
            planCtx.fillRect(x, y, width, height);
            planCtx.strokeStyle = '#374151';
            planCtx.lineWidth = 2;
            planCtx.strokeRect(x, y, width, height);
            const padding = 10;
            const fs = Math.max(12, fontSize);
            planCtx.fillStyle = textColor;
            planCtx.font = `${fs}px sans-serif`;
            planCtx.textBaseline = 'top';
            planCtx.textAlign = 'left';
            planCtx.save();
            planCtx.beginPath();
            planCtx.rect(x + padding, y + padding, width - padding * 2, height - padding * 2);
            planCtx.clip();
            const words = content.split(' ');
            let line = '';
            let lineY = y + padding;
            const lineHeight = fs * 1.3;
            for (const word of words) {
              const testLine = line ? line + ' ' + word : word;
              if (planCtx.measureText(testLine).width > width - padding * 2 && line) {
                planCtx.fillText(line, x + padding, lineY);
                line = word;
                lineY += lineHeight;
                if (lineY + lineHeight > y + height) break;
              } else {
                line = testLine;
              }
            }
            if (line) planCtx.fillText(line, x + padding, lineY);
            planCtx.restore();
          });
        };

        // Helper: add a composited canvas as a new PDF page
        const addAnnotatedPage = (planCanvas: HTMLCanvasElement, categoryLabel: string) => {
          const dataUrl = planCanvas.toDataURL('image/jpeg', 0.92);
          const isLandscape = planCanvas.width > planCanvas.height;
          doc.addPage(isLandscape ? 'l' : 'p');
          const pageW = doc.internal.pageSize.getWidth();
          const pageH = doc.internal.pageSize.getHeight();
          const innerMargin = 10;
          const titleH = 14;
          const availW = pageW - innerMargin * 2;
          const availH = pageH - innerMargin * 2 - titleH;
          const imgAspect = planCanvas.width / planCanvas.height;
          const boxAspect = availW / availH;
          let imgW: number, imgH: number;
          if (imgAspect > boxAspect) {
            imgW = availW;
            imgH = availW / imgAspect;
          } else {
            imgH = availH;
            imgW = availH * imgAspect;
          }
          const imgX = innerMargin + (availW - imgW) / 2;
          const imgY = innerMargin + titleH;
          doc.setFontSize(11);
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(0, 0, 0);
          doc.text(`Annotated Plan \u2014 ${categoryLabel}`, innerMargin, innerMargin + 9);
          doc.addImage(dataUrl, 'JPEG', imgX, imgY, imgW, imgH);
        };

        // Collect unique category names from visible measurements
        const visibleMeasurements = measurements.filter(
          m => !hiddenCategories.has(m.name) && !hiddenMeasurements.has(m.id)
        );
        const categoryNames = Array.from(new Set(visibleMeasurements.map(m => m.name)));

        // Generate one annotated page per category
        for (const categoryName of categoryNames) {
          const categoryMeasurements = visibleMeasurements.filter(m => m.name === categoryName);
          if (categoryMeasurements.length === 0) continue;

          // Render a fresh base plan for this category
          const planCanvas = await renderBasePlan();
          const planCtx = planCanvas.getContext('2d')!;

          // Draw only this category's measurements
          categoryMeasurements.forEach(m => drawMeasurement(planCtx, m));

          // Draw text annotations (they are global context, shown on every page)
          drawTextAnnotations(planCtx);

          addAnnotatedPage(planCanvas, categoryName);
        }
      } catch (err) {
        console.warn('Could not add annotated plan pages to PDF:', err);
      }
    }

    // Save PDF
    doc.save(`${project?.name || "measurements"}.pdf`);
    toast.success("PDF exported");
  };

  // Export measurements to CSV
  const exportMeasurementsCSV = () => {
    if (!measurements || measurements.length === 0) {
      toast.error("No measurements to export");
      return;
    }

    const data = measurements.map((m) => {
      const isWallMeasurement = WALL_CATEGORIES.includes(m.name);
      const isPoint = !isWallMeasurement && (m.type === 'point' || (m.count !== null && m.count !== undefined && m.type !== 'line'));
      const isLine = !isWallMeasurement && !isPoint && (m.perimeter === null || m.perimeter === undefined);
      
      let type: string;
      let value: string;
      if (isWallMeasurement) {
        const height = m.count != null ? (m.count / 1000).toFixed(2) : '?';
        type = 'Wall';
        value = `${m.perimeter} ${scaleUnit} linear x ${height} ${scaleUnit} h = ${m.area} ${scaleUnit}\u00b2`;
      } else if (isPoint) {
        type = 'Point';
        value = '1 item';
      } else if (isLine) {
        type = 'Line';
        value = `${m.area} ${scaleUnit}`;
      } else {
        type = 'Area';
        value = `${m.area} ${scaleUnit}\u00b2`;
      }
      
      return { name: m.name, type, value, color: m.color };
    });

    const csv = [
      "Name,Type,Value,Color",
      ...data.map((row) => `"${row.name}","${row.type}","${row.value}","${row.color}"`),
    ].join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${project?.name || "measurements"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("CSV exported");
  };

  if (authLoading || projectLoading) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user || !project) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-background">
        <Card>
          <CardHeader>
            <CardTitle>Project Not Found</CardTitle>
            <CardDescription>The project you're looking for doesn't exist</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => setLocation("/projects")}>Back to Projects</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="h-dvh bg-background flex flex-col overscroll-none select-none-touch overflow-hidden">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border bg-card shadow-sm pt-safe">
        {/* Top Row - Project Name and Export */}
        <div className="px-3 md:px-6 py-3 border-b border-border flex items-center justify-between gap-2">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => setLocation("/projects")}>
              <ArrowLeft className="w-4 h-4" />
              <span className="hidden sm:inline ml-2">Back</span>
            </Button>
            <Separator orientation="vertical" className="h-6" />
            {editingProjectName ? (
              <div className="flex items-center gap-2">
                <Input
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  className="w-64 h-8"
                />
                <Button
                  size="sm"
                  onClick={() => updateProjectMutation.mutate({ id: projectId, name: newProjectName })}
                >
                  <Save className="w-4 h-4" />
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <h1 className="text-base md:text-lg font-semibold text-foreground truncate max-w-[140px] sm:max-w-xs md:max-w-none">{project.name}</h1>
                <Button variant="ghost" size="sm" onClick={() => setEditingProjectName(true)}>
                  <Edit2 className="w-4 h-4" />
                </Button>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* Mobile: sidebar toggle button */}
            <Button
              variant="outline"
              size="sm"
              className="md:hidden"
              onClick={() => setIsSidebarOpen(prev => !prev)}
            >
              <ChevronRight className="w-4 h-4" />
              <span className="ml-1 text-xs">Measurements</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => setShowCategoryManager(true)}
              title="Manage Categories"
            >
              <Settings2 className="w-4 h-4" />
              <span className="hidden sm:inline">Categories</span>
            </Button>
            <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                <Download className="w-4 h-4" />
                <span className="hidden sm:inline">Export</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={exportMeasurementsPDF} className="gap-2">
                <FileText className="w-4 h-4" />
                Export PDF Report
              </DropdownMenuItem>
              <DropdownMenuItem onClick={exportMeasurementsCSV} className="gap-2">
                <Download className="w-4 h-4" />
                Export CSV Data
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          </div>
        </div>

        {/* Bottom Row - Toolbar with all controls */}
        <div className="px-3 md:px-6 py-2 flex items-center gap-3 md:gap-6 overflow-x-auto scrollbar-none">
          {/* Drawing Tools */}
          <div className="flex items-center gap-2">
            <span className="hidden sm:inline text-sm font-medium text-muted-foreground">Tools:</span>
            <Button
              variant={isDrawing ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setIsDrawing(!isDrawing);
                setIsEditMode(false);
                setIsExactMode(false);
                setIsCountingMode(false);
                if (isDrawing) setCurrentPolygon([]);
              }}
            >
              {isDrawing ? "Stop Drawing" : "Draw"}
            </Button>
            <Button
              variant={isCountingMode ? "default" : "outline"}
              size="sm"
              onClick={() => {
                if (isCountingMode) {
                  // Stop counting
                  setIsCountingMode(false);
                  setIsDrawing(false);
                } else {
                  // Show category selection dialog
                  setShowCountCategoryDialog(true);
                }
              }}
            >
              {isCountingMode ? "Stop Counting" : "Count"}
            </Button>
            <Button
              variant={isEditMode ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setIsEditMode(!isEditMode);
                setIsDrawing(false);
                setIsCountingMode(false);
                setIsExactMode(false);
                setIsTextMode(false);
                setSelectedMeasurementId(null);
              }}
            >
              {isEditMode ? "Stop Edit" : "Edit"}
            </Button>
            <Button
              variant={isTextMode ? "default" : "outline"}
              size="sm"
              onClick={() => {
                const next = !isTextMode;
                setIsTextMode(next);
                if (next) {
                  setIsDrawing(false);
                  setIsEditMode(false);
                  setIsCountingMode(false);
                  setCurrentPolygon([]);
                }
              }}
              title="Add text box annotation"
            >
              <Type className="w-4 h-4 mr-1" />
              {isTextMode ? "Stop Text" : "Text"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsCalibrating(true)}
            >
              Calibrate
            </Button>
          </div>

          <Separator orientation="vertical" className="h-6" />

          {/* Zoom Controls */}
          <div className="flex items-center gap-2">
            <span className="hidden sm:inline text-sm font-medium text-muted-foreground">Zoom:</span>
            <Button
              variant="outline"
              size="sm"
              onClick={handleZoomOut}
              disabled={zoomLevel <= 0.1}
            >
              <ZoomOut className="w-4 h-4" />
            </Button>
            <span className="text-sm font-mono w-12 text-center">{(zoomLevel * 100).toFixed(0)}%</span>
            <Button
              variant="outline"
              size="sm"
              onClick={handleZoomIn}
              disabled={zoomLevel >= 4.0}
            >
              <ZoomIn className="w-4 h-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleZoomReset}
              title="Reset zoom (100%)"
            >
              <RotateCcw className="w-4 h-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleFitToScreen()}
              title="Fit to screen (F)"
            >
              <Maximize2 className="w-4 h-4" />
            </Button>
          </div>

          <Separator orientation="vertical" className="h-6" />

          {/* Scale Settings */}
          <div className="flex items-center gap-2">
            <span className="hidden sm:inline text-sm font-medium text-muted-foreground">Scale:</span>
            <Input
              type="number"
              value={scale}
              onChange={(e) => setScale(parseFloat(e.target.value) || 1.0)}
              className="w-20 h-8"
              step="0.1"
            />
            <Select value={scaleUnit} onValueChange={(val) => {
              setScaleUnit(val);
              updateProjectMutation.mutate({ id: projectId, scaleUnit: val });
            }}>
              <SelectTrigger className="w-20 h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ft">ft</SelectItem>
                <SelectItem value="m">m</SelectItem>
              </SelectContent>
            </Select>
            <span className="hidden sm:inline text-sm text-muted-foreground">per inch</span>
          </div>

          <Separator orientation="vertical" className="h-6" />

          {/* Category Selector */}
          {isDrawing && (
            <div className="flex items-center gap-2">
              <span className="hidden sm:inline text-sm font-medium text-muted-foreground">Category:</span>
              <Select
                value={isCustomCategory ? "Other" : selectedCategory}
                onValueChange={(value) => {
                  if (value === "Other") {
                    setIsCustomCategory(true);
                    setSelectedCategory("");
                    setMeasurementName("");
                  } else {
                    setIsCustomCategory(false);
                    setSelectedCategory(value);
                    setMeasurementName(value);
                    // Auto-switch drawing mode based on category measurementType
                    const customCat = customCategories.find(c => c.name === value);
                    if (customCat && customCat.measurementType === 'count') {
                      // Switch to count mode for count-type custom categories
                      setIsDrawing(false);
                      setCurrentPolygon([]);
                      setShowCountCategoryDialog(true);
                    }
                  }
                }}
              >
                <SelectTrigger className="w-44 h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {/* Built-in preset categories */}
                  {PRESET_CATEGORIES.filter(c => c !== 'Other').map((category) => (
                    <SelectItem key={category} value={category}>
                      {category}
                    </SelectItem>
                  ))}
                  {/* User's saved custom categories — shared across all projects */}
                  {customCategories.length > 0 && (
                    <>
                      <div className="px-2 py-1 text-xs font-semibold text-muted-foreground border-t mt-1 pt-2">My Categories</div>
                      {customCategories.map((category) => (
                        <SelectItem key={category.id} value={category.name}>
                          {category.name}
                        </SelectItem>
                      ))}
                    </>
                  )}
                  <SelectItem value="Other">Other (Create New)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Color Picker */}
          {isDrawing && (
            <div className="flex items-center gap-2">
              <span className="hidden sm:inline text-sm font-medium text-muted-foreground">Color:</span>
              <div className="flex gap-1">
                {PRESET_COLORS.slice(0, 5).map((color) => (
                  <button
                    key={color}
                    onClick={() => setSelectedColor(color)}
                    className={`w-6 h-6 rounded border-2 transition-all ${
                      selectedColor === color ? "border-foreground scale-110" : "border-border"
                    }`}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Exact Mode Toggle */}
          {isDrawing && (
            <>
              <Separator orientation="vertical" className="h-6" />
              <div className="flex items-center gap-2">
                <span className="hidden sm:inline text-sm font-medium text-muted-foreground">Exact:</span>
                <Button
                  variant={isExactMode ? "default" : "outline"}
                  size="sm"
                  onClick={() => setIsExactMode(!isExactMode)}
                >
                  {isExactMode ? "On" : "Off"}
                </Button>
                {isExactMode && (
                  <Input
                    type="number"
                    placeholder="Distance"
                    value={exactDistance}
                    onChange={(e) => setExactDistance(e.target.value)}
                    className="w-24 h-8"
                  />
                )}
              </div>
            </>
          )}
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden overscroll-none">
        {/* Canvas Area */}
        <div 
          className="flex-1 overflow-hidden p-2 md:p-4 pb-safe overscroll-none" 
          ref={containerRef}
          onWheel={(e) => {
            // Prevent page scrolling when mouse is over canvas area
            // The canvas itself handles zoom via its own onWheel handler
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <div 
            className="relative inline-block"
            style={{
              // No CSS transition - prevents lag/drift feeling during zoom/pan
              transition: 'none',
              transform: `translate(${panOffset.x}px, ${panOffset.y}px)`,
            }}
          >
            <canvas ref={canvasRef} className="border border-border rounded-lg shadow-lg gpu-layer" />
            {/* Inline text editor overlay for text annotations */}
            {editingTextId !== null && (() => {
              const ann = textAnnotationsList.find(a => a.id === editingTextId);
              if (!ann) return null;
              return (
                <div
                  style={{
                    position: 'absolute',
                    left: ann.x * zoomLevel,
                    top: ann.y * zoomLevel,
                    width: ann.width * zoomLevel,
                    height: ann.height * zoomLevel,
                    zIndex: 100,
                  }}
                >
                  <textarea
                    autoFocus
                    value={editingTextValue}
                    onChange={(e) => setEditingTextValue(e.target.value)}
                    onBlur={() => {
                      if (editingTextId !== null) {
                        updateTextAnnotationMutation.mutate({ id: editingTextId, projectId, content: editingTextValue });
                      }
                      setEditingTextId(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        setEditingTextId(null);
                      }
                    }}
                    style={{
                      width: '100%',
                      height: '100%',
                      resize: 'none',
                      border: '2px solid #3b82f6',
                      borderRadius: 2,
                      padding: 8,
                      fontSize: Math.max(8, ann.fontSize * zoomLevel),
                      fontFamily: 'sans-serif',
                      background: ann.bgColor === 'transparent' ? 'rgba(255,255,255,0.95)' : ann.bgColor,
                      color: ann.textColor,
                      outline: 'none',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
              );
            })()}
            <canvas
              ref={overlayCanvasRef}
              onClick={(e) => {
                // Only handle left clicks for drawing/editing
                if (e.button === 0) {
                  handleCanvasClick(e);
                }
              }}
              onAuxClick={(e) => {
                // Prevent middle button from triggering onClick
                e.preventDefault();
              }}
              onMouseDown={handleMouseDown}
              onMouseUp={handleMouseUp}
              onWheel={handleWheel}
              onMouseMove={(e) => {
                const canvas = overlayCanvasRef.current!;
                const rect = canvas.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;

                // Text annotation drag
                if (draggingTextId !== null && textDragStart) {
                  const dx = (x - textDragStart.mouseX) / zoomLevel;
                  const dy = (y - textDragStart.mouseY) / zoomLevel;
                  // Optimistic local update for smooth dragging
                  const ann = textAnnotationsList.find(a => a.id === draggingTextId);
                  if (ann) {
                    (ann as any).x = textDragStart.origX + dx;
                    (ann as any).y = textDragStart.origY + dy;
                    redrawOverlay();
                  }
                  return;
                }

                // Text annotation resize
                if (resizingTextId !== null && textResizeStart) {
                  const dx = (x - textResizeStart.mouseX) / zoomLevel;
                  const dy = (y - textResizeStart.mouseY) / zoomLevel;
                  const ann = textAnnotationsList.find(a => a.id === resizingTextId);
                  if (ann) {
                    (ann as any).width = Math.max(80, textResizeStart.origW + dx);
                    (ann as any).height = Math.max(40, textResizeStart.origH + dy);
                    redrawOverlay();
                  }
                  return;
                }

                // Vertex dragging in edit mode
                if (draggingVertexIndex !== null && selectedMeasurementId && measurements) {
                  const selectedMeasurement = measurements.find(m => m.id === selectedMeasurementId);
                  if (selectedMeasurement) {
                    const coords = [...(selectedMeasurement.coordinates as Point[])];
                    coords[draggingVertexIndex] = { x: x / zoomLevel, y: y / zoomLevel };
                    // Update the measurement in the local state for real-time feedback
                    selectedMeasurement.coordinates = coords;
                    redrawOverlay();
                  }
                  return;
                }

                // Handle panning (independent of drawing)
                if (isPanning && panStart) {
                  const dx = e.clientX - panStart.x;
                  const dy = e.clientY - panStart.y;
                  const newPanMouse = { x: panOffsetRef.current.x + dx, y: panOffsetRef.current.y + dy };
                  panOffsetRef.current = newPanMouse;
                  setPanOffset(newPanMouse);
                  setPanStart({ x: e.clientX, y: e.clientY });
                }
                
                // Handle drawing cursor (can happen simultaneously with panning)
                if (isDrawing) {
                  setCursorPosition({ x, y });
                }
              }}
              onMouseLeave={() => {
                setCursorPosition(null);
                setIsPanning(false);
                setPanStart(null);
              }}
              onDoubleClick={(e) => {
                const canvas = overlayCanvasRef.current!;
                const rect = canvas.getBoundingClientRect();
                const x = (e.clientX - rect.left) / zoomLevel;
                const y = (e.clientY - rect.top) / zoomLevel;
                const ann = textAnnotationsList.find((a) => {
                  if (a.pageNumber !== currentPage) return false;
                  return x >= a.x && x <= a.x + a.width && y >= a.y && y <= a.y + a.height;
                });
                if (ann) {
                  setEditingTextId(ann.id);
                  setEditingTextValue(ann.content);
                  setSelectedTextId(ann.id);
                }
              }}
              onContextMenu={(e) => e.preventDefault()}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              className="absolute top-0 left-0 gpu-layer"
              style={{ 
                pointerEvents: "auto",
                cursor: isPanning ? "grabbing" : (isDrawing ? "none" : "grab"),
                touchAction: "none",  // prevent browser handling touch (scroll/zoom)
              }}
            />
          </div>
        </div>

        {/* Sidebar - desktop: always visible right panel; mobile: slide-up overlay */}
        {/* Mobile overlay backdrop */}
        {isSidebarOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/50 md:hidden"
            onClick={() => setIsSidebarOpen(false)}
          />
        )}
        <div
          ref={sidebarRef}
          className={[
            "bg-card overflow-y-auto flex-shrink-0 z-50",
            // Desktop: always-visible right panel
            "md:w-80 md:border-l md:border-border md:relative md:translate-y-0",
            // Mobile: fixed bottom sheet, full-width, slides up when open
            "fixed bottom-0 left-0 right-0 md:static",
            "max-h-[70vh] md:max-h-none",
            "rounded-t-2xl md:rounded-none border-t md:border-t-0 border-border",
            "transition-transform duration-300",
            "[transition-timing-function:cubic-bezier(0.32,0.72,0,1)]",
            isSidebarOpen ? "translate-y-0" : "translate-y-full md:translate-y-0",
          ].join(" ")}
        >
          {/* Mobile drag handle */}
          <div className="md:hidden flex justify-center pt-3 pb-1">
            <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
          </div>
          <div className="md:hidden flex justify-between items-center px-4 pb-2">
            <span className="font-semibold text-sm">Measurements</span>
            <Button variant="ghost" size="sm" onClick={() => setIsSidebarOpen(false)}>
              <ChevronDown className="w-4 h-4" />
            </Button>
          </div>
          <div className="p-4 space-y-4 pb-safe">
            {/* Area Totals Summary */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-semibold">Summary</CardTitle>
              </CardHeader>
              <CardContent>
                {measurements && measurements.length > 0 ? (
                  <div className="space-y-3">
                    <div className="flex justify-between items-center p-3 rounded-lg bg-primary/10 border border-primary/20">
                      <span className="font-semibold text-sm">Total Area</span>
                      <span className="font-bold text-lg text-primary">
                        {measurements
                          .filter(m => m.type !== 'line' || !WALL_CATEGORIES.includes(m.name))
                          .filter(m => m.type === 'area')
                          .reduce((sum, m) => sum + parseFloat(m.area || '0'), 0).toFixed(2)} {scaleUnit}²
                      </span>
                    </div>
                    <div className="space-y-2">
                      <p className="text-xs text-muted-foreground font-medium">By Color:</p>
                      {Object.entries(
                        measurements
                          .filter(m => m.type === 'area') // only area measurements in color summary
                          .reduce((acc, m) => {
                            const color = m.color;
                            acc[color] = (acc[color] || 0) + parseFloat(m.area || '0');
                            return acc;
                          }, {} as Record<string, number>)
                      ).map(([color, area]) => (
                        <div key={color} className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded" style={{ backgroundColor: color }} />
                            <span className="text-muted-foreground">Subtotal</span>
                          </div>
                          <span className="font-medium">{area.toFixed(2)} {scaleUnit}²</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No measurements yet
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Measurements List */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Measurements</CardTitle>
                <CardDescription>
                  {measurements?.length || 0} measurement{measurements?.length === 1 ? "" : "s"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {measurementsLoading ? (
                  <div className="flex justify-center py-4">
                    <Loader2 className="w-6 h-6 animate-spin text-primary" />
                  </div>
                ) : measurements?.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No measurements yet
                  </p>
                ) : (
                  <div className="space-y-3">
                    {(() => {
                      return Object.entries(measurementsByCategory).map(([categoryName, items]) => {
                        // Check if this is a Wall category (has perimeter=linearFt, count=height*100, type=line)
                        const isWallCategory = WALL_CATEGORIES.includes(categoryName);

                        // Check if this is a point counting category (but NOT a wall category)
                        const isPointCategory = !isWallCategory && items.some(m => m.type === 'point' || (m.count !== null && m.count !== undefined && m.type !== 'line'));
                        
                        // Calculate total count for point measurements
                        const totalCount = isPointCategory
                          ? items.filter(m => m.type === 'point' || (m.count !== null && m.count !== undefined && m.type !== 'line')).length
                          : 0;

                        // Wall category totals
                        const totalWallLinearFt = isWallCategory
                          ? items.reduce((sum, m) => sum + parseFloat(m.perimeter || '0'), 0)
                          : 0;
                        const totalWallArea = isWallCategory
                          ? items.reduce((sum, m) => sum + parseFloat(m.area || '0'), 0)
                          : 0;
                        
                        // Calculate total linear feet for regular line measurements in this category
                        const totalLinearFt = !isWallCategory ? items
                          .filter(m => m.type !== 'point' && (m.perimeter === null || m.perimeter === undefined))
                          .reduce((sum, m) => sum + parseFloat(m.area || '0'), 0) : 0;
                        
                        const hasLines = totalLinearFt > 0;

                        return (
                          <div key={categoryName} className="border border-border rounded-lg overflow-hidden">
                            {/* Category Header */}
                            <div className="bg-accent/30 px-3 py-2 border-b border-border">
                              <div className="flex items-center justify-between gap-2">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-5 w-5 p-0 shrink-0"
                                  onClick={() => {
                                    setExpandedCategories(prev => {
                                      const next = new Set(prev);
                                      if (next.has(categoryName)) {
                                        next.delete(categoryName);
                                      } else {
                                        next.add(categoryName);
                                      }
                                      return next;
                                    });
                                  }}
                                >
                                  {expandedCategories.has(categoryName) ? (
                                    <ChevronDown className="w-4 h-4 text-muted-foreground" />
                                  ) : (
                                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                                  )}
                                </Button>
                                <div className="flex-1">
                                  <div className="flex items-center justify-between">
                                    <p className="font-semibold text-sm">{categoryName}</p>
                                    {isWallCategory && (
                                      <div className="text-right">
                                        <p className="text-xs font-medium text-primary">
                                          {totalWallLinearFt.toFixed(2)} {scaleUnit} linear
                                        </p>
                                        <p className="text-xs font-medium text-orange-500">
                                          {totalWallArea.toFixed(2)} {scaleUnit}² area
                                        </p>
                                      </div>
                                    )}
                                    {isPointCategory && (
                                      <p className="text-xs font-medium text-primary">
                                        Count: {totalCount} item{totalCount === 1 ? '' : 's'}
                                      </p>
                                    )}
                                    {!isPointCategory && !isWallCategory && hasLines && (
                                      <p className="text-xs font-medium text-primary">
                                        Total: {totalLinearFt.toFixed(2)} {scaleUnit}
                                      </p>
                                    )}
                                  </div>
                                  <p className="text-xs text-muted-foreground mt-0.5">
                                    {items.length} measurement{items.length === 1 ? '' : 's'}
                                  </p>
                                </div>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 w-7 p-0 shrink-0"
                                  onClick={() => {
                                    setHiddenCategories(prev => {
                                      const next = new Set(prev);
                                      if (next.has(categoryName)) {
                                        next.delete(categoryName);
                                      } else {
                                        next.add(categoryName);
                                      }
                                      return next;
                                    });
                                  }}
                                >
                                  {hiddenCategories.has(categoryName) ? (
                                    <EyeOff className="w-4 h-4 text-muted-foreground" />
                                  ) : (
                                    <Eye className="w-4 h-4 text-muted-foreground" />
                                  )}
                                </Button>
                              </div>
                            </div>
                            
                            {/* Category Items */}
                            {expandedCategories.has(categoryName) && (
                            <div className="divide-y divide-border">
                              {items.map((measurement, index) => {
                                const isPoint = measurement.type === 'point';
                                // Wall measurements have perimeter set (linear ft) but are NOT area measurements
                                const isLine = !isPoint && !isWallCategory && (measurement.perimeter === null || measurement.perimeter === undefined);
                                return (
                                  <div
                                    key={measurement.id}
                                    className="flex items-center justify-between p-2.5 hover:bg-accent/50 transition-colors"
                                  >
                                    <div className="flex items-center gap-2.5 flex-1">
                                      <div
                                        className="w-3 h-3 rounded"
                                        style={{ backgroundColor: measurement.color }}
                                      />
                                      <div className="flex-1 min-w-0">
                                        <div className="text-xs text-muted-foreground">
                                          {isPoint ? (
                                            <div className="flex items-center gap-1.5">
                                              <span>Marker #{index + 1}</span>
                                            </div>
                                          ) : isWallCategory ? (
                                            <>
                                              <div>{measurement.perimeter} {scaleUnit} linear</div>
                                              {measurement.count != null && (
                                                <div className="text-[10px]">Height: {(measurement.count / 1000).toFixed(2)} {scaleUnit}</div>
                                              )}
                                              <div className="text-[10px] font-medium text-orange-500">Area: {measurement.area} {scaleUnit}²</div>
                                            </>
                                          ) : isLine ? (
                                            <div>{measurement.area} {scaleUnit}</div>
                                          ) : (
                                            <>
                                              <div>{measurement.area} {scaleUnit}²</div>
                                              {measurement.perimeter && (
                                                <div className="text-[10px]">Perimeter: {measurement.perimeter} {scaleUnit}</div>
                                              )}
                                            </>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-1">
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-7 w-7 p-0"
                                        onClick={() => {
                                          setHiddenMeasurements(prev => {
                                            const next = new Set(prev);
                                            if (next.has(measurement.id)) {
                                              next.delete(measurement.id);
                                            } else {
                                              next.add(measurement.id);
                                            }
                                            return next;
                                          });
                                        }}
                                      >
                                        {hiddenMeasurements.has(measurement.id) ? (
                                          <EyeOff className="w-3.5 h-3.5 text-muted-foreground" />
                                        ) : (
                                          <Eye className="w-3.5 h-3.5 text-muted-foreground" />
                                        )}
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-7 w-7 p-0"
                                        onClick={() => {
                                          if (confirm("Delete this measurement?")) {
                                            deleteMeasurementMutation.mutate({ id: measurement.id });
                                          }
                                        }}
                                      >
                                        <Trash2 className="w-3.5 h-3.5 text-destructive" />
                                      </Button>
                                    </div>
                                  </div>
                                );
                              })
                            }
                            </div>
                            )}
                          </div>
                        );
                      });
                    })()}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Notes */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Notes</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full min-h-24 p-2 text-sm border border-input rounded-md bg-background resize-none"
                  placeholder="Add notes about this project..."
                />
                <Button
                  size="sm"
                  onClick={() => updateProjectMutation.mutate({ id: projectId, notes })}
                  className="w-full"
                >
                  Save Notes
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Name Dialog */}
      <Dialog open={isNameDialogOpen} onOpenChange={setIsNameDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Name This Measurement</DialogTitle>
            <DialogDescription>
              {currentPolygon.length === 2 || !isShapeClosed ? (
                <>Distance: {calculatePolylineLength(currentPolygon).toFixed(2)} {scaleUnit}</>
              ) : (
                <div className="space-y-1">
                  <div>Area: {calculateArea(currentPolygon).toFixed(2)} {scaleUnit}²</div>
                  <div className="text-xs">Perimeter: {calculatePerimeter(currentPolygon).toFixed(2)} {scaleUnit}</div>
                </div>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="category-select">Category</Label>
              <Select
                value={isCustomCategory ? "Other" : selectedCategory}
                onValueChange={(value) => {
                  if (value === "Other") {
                    setIsCustomCategory(true);
                    setSelectedCategory("");
                    setMeasurementName("");
                  } else {
                    setIsCustomCategory(false);
                    setSelectedCategory(value);
                    setMeasurementName(value);
                  }
                }}
              >
                <SelectTrigger id="category-select">
                  <SelectValue placeholder="Select a category" />
                </SelectTrigger>
                <SelectContent>
                  {/* Built-in preset categories (excluding 'Other' — handled below) */}
                  {PRESET_CATEGORIES.filter(c => c !== 'Other').map((category) => (
                    <SelectItem key={category} value={category}>
                      {category}
                    </SelectItem>
                  ))}
                  {/* User's saved custom categories — available across all projects */}
                  {customCategories.length > 0 && (
                    <>
                      <div className="px-2 py-1 text-xs font-semibold text-muted-foreground border-t mt-1 pt-2">My Categories</div>
                      {customCategories.map((category) => (
                        <SelectItem key={category.id} value={category.name}>
                          {category.name}
                        </SelectItem>
                      ))}
                    </>
                  )}
                  <SelectItem value="Other">Other (Create New)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            {isCustomCategory && (
              <div className="space-y-2">
                <Label htmlFor="custom-name">Custom Category Name</Label>
                <Input
                  id="custom-name"
                  value={measurementName}
                  onChange={(e) => setMeasurementName(e.target.value)}
                  placeholder="Enter custom category name"
                  autoFocus
                />
                <p className="text-xs text-muted-foreground">This category will be saved and available in all your future projects.</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setIsNameDialogOpen(false);
              setIsShapeClosed(false);
            }}>
              Cancel
            </Button>
            <Button onClick={saveMeasurement} disabled={createMeasurementMutation.isPending || createCategoryMutation.isPending}>
              {createMeasurementMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Wall Height Dialog */}
      <Dialog open={isWallHeightDialogOpen} onOpenChange={(open) => {
        if (!open) {
          setIsWallHeightDialogOpen(false);
          setPendingWallMeasurement(null);
          setWallHeight("");
          setCurrentPolygon([]);
          setIsShapeClosed(false);
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Wall Height</DialogTitle>
            <DialogDescription>
              {pendingWallMeasurement && (
                <span>
                  Wall length: <strong>{pendingWallMeasurement.linearFt.toFixed(2)} {scaleUnit}</strong>.
                  Enter the wall height to calculate the total wall area.
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="wall-height-input">Wall Height ({scaleUnit})</Label>
              <Input
                id="wall-height-input"
                type="number"
                min="0.01"
                step="0.01"
                value={wallHeight}
                onChange={(e) => setWallHeight(e.target.value)}
                placeholder={`e.g. 8`}
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && saveWallMeasurement()}
              />
            </div>
            {wallHeight && !isNaN(parseFloat(wallHeight)) && parseFloat(wallHeight) > 0 && pendingWallMeasurement && (
              <div className="rounded-md bg-muted px-4 py-3 text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Linear footage:</span>
                  <span className="font-medium">{pendingWallMeasurement.linearFt.toFixed(2)} {scaleUnit}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Height:</span>
                  <span className="font-medium">{parseFloat(wallHeight).toFixed(2)} {scaleUnit}</span>
                </div>
                <div className="flex justify-between border-t border-border pt-1 mt-1">
                  <span className="font-semibold">Wall Area:</span>
                  <span className="font-bold text-primary">
                    {(pendingWallMeasurement.linearFt * parseFloat(wallHeight)).toFixed(2)} {scaleUnit}²
                  </span>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setIsWallHeightDialogOpen(false);
              setPendingWallMeasurement(null);
              setWallHeight("");
              setCurrentPolygon([]);
              setIsShapeClosed(false);
            }}>
              Cancel
            </Button>
            <Button onClick={saveWallMeasurement} disabled={createMeasurementMutation.isPending}>
              {createMeasurementMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Save Wall
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Count Category Selection Dialog */}
      <Dialog open={showCountCategoryDialog} onOpenChange={setShowCountCategoryDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Select Counting Category</DialogTitle>
            <DialogDescription>
              Choose what you want to count (e.g., Curbs, Pipes). Each click will place a marker.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="count-category-select">Category</Label>
              <Select
                value={isCustomCategory ? "Other" : selectedCategory}
                onValueChange={(value) => {
                  if (value === "Other") {
                    setIsCustomCategory(true);
                    setSelectedCategory("");
                    setMeasurementName("");
                  } else {
                    setIsCustomCategory(false);
                    setSelectedCategory(value);
                    setMeasurementName(value);
                  }
                }}
              >
                <SelectTrigger id="count-category-select">
                  <SelectValue placeholder="Select a category" />
                </SelectTrigger>
                <SelectContent>
                  {PRESET_POINT_COUNT_CATEGORIES.map((category) => (
                    <SelectItem key={category} value={category}>
                      {category}
                    </SelectItem>
                  ))}
                  {customCategories.map((category) => (
                    <SelectItem key={category.id} value={category.name}>
                      {category.name}
                    </SelectItem>
                  ))}
                  <SelectItem value="Other">Other (Create New)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            {isCustomCategory && (
              <div className="space-y-2">
                <Label htmlFor="custom-count-name">Custom Category Name</Label>
                <Input
                  id="custom-count-name"
                  value={measurementName}
                  onChange={(e) => setMeasurementName(e.target.value)}
                  placeholder="Enter custom category name"
                  autoFocus
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setShowCountCategoryDialog(false);
            }}>
              Cancel
            </Button>
            <Button onClick={async () => {
              if (isCustomCategory && !measurementName.trim()) {
                return; // Don't start if custom name is empty
              }
              
              // If custom category, save it to database first
              if (isCustomCategory && measurementName.trim()) {
                try {
                  await createCategoryMutation.mutateAsync({ name: measurementName.trim() });
                  // Invalidate query cache to refresh the category list
                  await utils.countingCategories.list.invalidate();
                  // Set selectedCategory to the new custom category name
                  setSelectedCategory(measurementName.trim());
                  toast.success(`Created new category: ${measurementName}`);
                } catch (error) {
                  toast.error("Failed to create category");
                  return;
                }
              }
              
              setShowCountCategoryDialog(false);
              setIsCountingMode(true);
              setIsDrawing(true); // Enable drawing mode for point counting
              setIsEditMode(false);
              setIsExactMode(false);
            }} disabled={isCustomCategory && !measurementName.trim()}>
              Start Counting
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Category Manager Dialog */}
      <CategoryManager
        open={showCategoryManager}
        onOpenChange={setShowCategoryManager}
      />

      {/* Calibration Dialog */}
      <Dialog open={isCalibrationDialogOpen} onOpenChange={setIsCalibrationDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enter Known Distance</DialogTitle>
            <DialogDescription>
              Enter the actual distance between the two points you selected
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="calibration-distance">Known Distance</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="calibration-distance"
                  type="number"
                  step="0.1"
                  min="0.1"
                  value={calibrationDistance}
                  onChange={(e) => setCalibrationDistance(e.target.value)}
                  placeholder="e.g., 20"
                  className="flex-1"
                />
                <span className="text-sm font-medium">{scaleUnit}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Example: If the dimension line shows "20 ft", enter 20
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsCalibrationDialogOpen(false);
                setIsCalibrating(false);
                setCalibrationPoints([]);
                setCalibrationDistance("");
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (calibrationPoints.length === 2 && calibrationDistance) {
                  // Calculate pixel distance between the two points
                  const p1 = calibrationPoints[0];
                  const p2 = calibrationPoints[1];
                  const dx = p2.x - p1.x;
                  const dy = p2.y - p1.y;
                  const pixelDistance = Math.sqrt(dx * dx + dy * dy);
                  
                  // Convert pixel distance to inches (96 DPI)
                  const inchDistance = pixelDistance / 96;
                  
                  // Calculate scale: known distance / inch distance
                  const knownDistance = parseFloat(calibrationDistance);
                  const newScale = knownDistance / inchDistance;
                  
                  setScale(newScale);
                  
                  // Save to database
                  updateProjectMutation.mutate({
                    id: projectId,
                    scale: newScale.toString(),
                    scaleUnit,
                  });
                  
                  toast.success(`Scale calibrated: 1 inch = ${newScale.toFixed(2)} ${scaleUnit}`);
                  
                  // Reset calibration state
                  setIsCalibrationDialogOpen(false);
                  setIsCalibrating(false);
                  setCalibrationPoints([]);
                  setCalibrationDistance("");
                }
              }}
              disabled={!calibrationDistance}
            >
              Apply Calibration
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
