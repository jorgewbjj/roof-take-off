import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { trpc } from "@/lib/trpc";
import type { Cutout, DimensionLine, Callout } from "../../../drizzle/schema";
import { ArrowLeft, Loader2, Plus, Trash2, Edit2, Save, Download, ZoomIn, ZoomOut, RotateCcw, Maximize2, Eye, EyeOff, FileText, ChevronRight, ChevronLeft, ChevronDown, Settings2, Type, X, Scissors, Square, Ruler, MessageSquare, Pencil, Hash, MousePointer2, SlidersHorizontal } from "lucide-react";
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

/**
 * Parse an architectural scale notation string and return the scale value
 * (real-world feet per drawing inch, at 96 DPI).
 *
 * Accepts formats like:
 *   1/8" = 1'-0"   →  8.0
 *   1/4" = 1'-0"   →  4.0
 *   3/32" = 1'-0"  →  10.667
 *   1/4"=1'        →  4.0
 *   0.25" = 1'     →  4.0
 *   1" = 10'       →  10.0  (custom)
 *
 * Returns null if the string cannot be parsed.
 */
function parseArchitecturalScale(input: string): number | null {
  if (!input.trim()) return null;

  // Normalise: remove smart quotes, collapse whitespace
  const s = input
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .trim();

  // Split on '=' — expect exactly two parts
  const parts = s.split('=');
  if (parts.length !== 2) return null;

  const drawingPart = parts[0].trim(); // e.g. "1/8\""
  const realPart    = parts[1].trim(); // e.g. "1'-0\""

  // ── Parse drawing side (inches) ──
  // Strip trailing inch marks and whitespace
  const drawingClean = drawingPart.replace(/["\s]/g, '');

  // Support mixed number like "1-1/2" or plain fraction "1/8" or decimal "0.125"
  let drawingInches: number | null = null;
  const mixedMatch = drawingClean.match(/^(\d+)-(\d+)\/(\d+)$/);
  const fracMatch  = drawingClean.match(/^(\d+)\/(\d+)$/);
  const decMatch   = drawingClean.match(/^(\d*\.?\d+)$/);

  if (mixedMatch) {
    drawingInches = parseInt(mixedMatch[1]) + parseInt(mixedMatch[2]) / parseInt(mixedMatch[3]);
  } else if (fracMatch) {
    drawingInches = parseInt(fracMatch[1]) / parseInt(fracMatch[2]);
  } else if (decMatch) {
    drawingInches = parseFloat(decMatch[1]);
  }

  if (drawingInches === null || drawingInches <= 0) return null;

  // ── Parse real-world side (feet) ──
  // Strip trailing inch marks and whitespace
  const realClean = realPart.replace(/["\s]/g, '');

  // Formats: "1'-0", "1'", "10'", "1.5'", "1'-6" (feet-inches)
  let realFeet: number | null = null;

  // feet-inches: e.g. 1'-0 or 1'-6
  const feetInchMatch = realClean.match(/^(\d+)'[-]?(\d+)$/);
  // feet only: e.g. 1' or 10'
  const feetOnlyMatch = realClean.match(/^(\d*\.?\d+)'$/);
  // bare number (assume feet): e.g. 10
  const bareMatch = realClean.match(/^(\d*\.?\d+)$/);

  if (feetInchMatch) {
    realFeet = parseInt(feetInchMatch[1]) + parseInt(feetInchMatch[2]) / 12;
  } else if (feetOnlyMatch) {
    realFeet = parseFloat(feetOnlyMatch[1]);
  } else if (bareMatch) {
    realFeet = parseFloat(bareMatch[1]);
  }

  if (realFeet === null || realFeet <= 0) return null;

  // ── Unit alignment with the draw-line calibration path ──
  //
  // The draw-line path stores coordinates in "baseScale PDF pixels" (PDF.js renders
  // at baseScale=2.5 × 72 DPI = 180 px/inch of physical paper).  It then converts
  // to a synthetic inch unit by dividing by 96:
  //
  //   inchDistance = pixelDistance / 96
  //   scale        = knownFeet / inchDistance
  //
  // So scale = real feet per (96 baseScale-pixels).
  // 96 baseScale-pixels = 96 / (baseScale × 72) physical paper inches
  //                     = 96 / (2.5 × 72) = 96 / 180 ≈ 0.5333 physical paper inches.
  //
  // The notation "1/8\" = 1'-0\"" means 1 physical paper inch → 8 real feet.
  // We need to convert to: (96/180) physical paper inches → ? real feet
  //   = 8 × (96/180) = 8 × 0.5333 ≈ 4.267 real feet per synthetic inch.
  //
  // Correction factor: 96 / (baseScale × PDF_DPI) = 96 / (2.5 × 72) = 96 / 180
  const BASE_SCALE = 2.5;
  const PDF_DPI    = 72;  // PDF points per physical inch (standard)
  const RENDER_DPI = 96;  // synthetic DPI used by the draw-line path
  const correctionFactor = RENDER_DPI / (BASE_SCALE * PDF_DPI); // ≈ 0.5333

  return (realFeet / drawingInches) * correctionFactor;
}

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
  // Scale notation calibration state
  const [showCalibrationChooser, setShowCalibrationChooser] = useState(false);
  const [scaleNotationInput, setScaleNotationInput] = useState("");
  const [scaleNotationError, setScaleNotationError] = useState<string | null>(null);
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
  // ─── Rectangle Area tool state ────────────────────────────────────────────────
  const [isRectMode, setIsRectMode] = useState(false);
  const [rectFirstPoint, setRectFirstPoint] = useState<Point | null>(null);

  // ─── Cutout tool state ────────────────────────────────────────────────────────
  const [isCutoutMode, setIsCutoutMode] = useState(false);
  const [cutoutParentId, setCutoutParentId] = useState<number | null>(null);
  const [showCutoutPickerDialog, setShowCutoutPickerDialog] = useState(false);

  // ─── Dimension Line tool state ────────────────────────────────────────────────
  const [isDimMode, setIsDimMode] = useState(false);
  const [dimStep, setDimStep] = useState<0 | 1 | 2>(0);
  const [dimPoint1, setDimPoint1] = useState<Point | null>(null);
  const [dimPoint2, setDimPoint2] = useState<Point | null>(null);
  const [dimOffsetPx, setDimOffsetPx] = useState(40);
  const [dimColor, setDimColor] = useState("#1e40af");
  const [isDraggingDimOffset, setIsDraggingDimOffset] = useState(false);

  // ─── Callout Bubble tool state ────────────────────────────────────────────────
  const [isCalloutMode, setIsCalloutMode] = useState(false);
  const [calloutStep, setCalloutStep] = useState<0 | 1>(0);
  const [calloutAnchor, setCalloutAnchor] = useState<Point | null>(null);
  const [selectedCalloutId, setSelectedCalloutId] = useState<number | null>(null);
  const [calloutDrafts, setCalloutDrafts] = useState<Record<number, Partial<Pick<Callout, 'anchorX' | 'anchorY' | 'bubbleX' | 'bubbleY' | 'bubbleW' | 'bubbleH'>>>>({});
  const calloutDraftsRef = useRef<Record<number, Partial<Pick<Callout, 'anchorX' | 'anchorY' | 'bubbleX' | 'bubbleY' | 'bubbleW' | 'bubbleH'>>>>({});
  const renderedCalloutsRef = useRef<Callout[]>([]);
  const lastCalloutTapRef = useRef<{ id: number; at: number } | null>(null);
  const calloutTouchDragRef = useRef<{ id: number; part: 'bubble' | 'anchor'; startX: number; startY: number; origX: number; origY: number } | null>(null);
  const [draggingCalloutPart, setDraggingCalloutPart] = useState<'bubble' | 'anchor' | null>(null);
  const [draggingCalloutId, setDraggingCalloutId] = useState<number | null>(null);
  const [calloutDragStart, setCalloutDragStart] = useState<{ mouseX: number; mouseY: number; origX: number; origY: number } | null>(null);
  const [editingCalloutId, setEditingCalloutId] = useState<number | null>(null);
  const [editingCalloutText, setEditingCalloutText] = useState("");

  const updateCalloutDraft = (id: number, changes: Partial<Pick<Callout, 'anchorX' | 'anchorY' | 'bubbleX' | 'bubbleY' | 'bubbleW' | 'bubbleH'>>) => {
    setCalloutDrafts(previous => {
      const next = { ...previous, [id]: { ...previous[id], ...changes } };
      calloutDraftsRef.current = next;
      return next;
    });
  };
  const findCalloutHitFromRef = (canvasX: number, canvasY: number) => {
    const x = canvasX / zoomLevelRef.current;
    const y = canvasY / zoomLevelRef.current;
    const anchorRadius = Math.max(8, 12 / zoomLevelRef.current);
    for (const callout of [...renderedCalloutsRef.current].reverse()) {
      if (Math.hypot(x - callout.anchorX, y - callout.anchorY) <= anchorRadius) return { callout, part: 'anchor' as const };
      if (x >= callout.bubbleX && x <= callout.bubbleX + callout.bubbleW && y >= callout.bubbleY && y <= callout.bubbleY + callout.bubbleH) return { callout, part: 'bubble' as const };
    }
    return null;
  };

  const baseScale = 2.5; // High quality PDF rendering base scale
  // Maximum safe canvas dimension in pixels — exceeding this causes GPU context loss / crash
  const MAX_CANVAS_PX = 8192;
  // Ref to cancel in-flight PDF renders when zoom changes before the previous render finishes
  const renderCancelRef = useRef<{ cancelled: boolean }>({ cancelled: false });

  // Refs to always have the latest zoom/pan values without stale closures
  const panOffsetRef = useRef({ x: 0, y: 0 });
  const zoomLevelRef = useRef(1.0);

  // RAF throttle ref — prevents redundant canvas redraws within the same animation frame
  const rafIdRef = useRef<number | null>(null);
  // Ref to always call the latest _doRedrawOverlay — avoids stale closure in the RAF wrapper
  const doRedrawRef = useRef<() => void>(() => {});
  // Tracks the ID of the most recently saved measurement for Ctrl+Z undo
  const lastSavedMeasurementIdRef = useRef<number | null>(null);

  // ─── Plan Tab state ──────────────────────────────────────────────────────────
  const [activeTabId, setActiveTabId] = useState<number | null>(null); // null = original project plan
  const [addTabDialogOpen, setAddTabDialogOpen] = useState(false);
  const [newTabName, setNewTabName] = useState("");
  const [newTabFile, setNewTabFile] = useState<File | null>(null);
  const [addTabLoading, setAddTabLoading] = useState(false);
  const [renamingTabId, setRenamingTabId] = useState<number | null>(null);
  const [renameTabValue, setRenameTabValue] = useState("");
  const [deleteTabConfirmId, setDeleteTabConfirmId] = useState<number | null>(null);
  const [renamingDefaultTab, setRenamingDefaultTab] = useState(false);
  const [renameDefaultTabValue, setRenameDefaultTabValue] = useState("");

  const utils = trpc.useUtils();
  const { data: project, isLoading: projectLoading } = trpc.projects.get.useQuery({ id: projectId });
  const { data: planTabsList = [], refetch: refetchPlanTabs } = trpc.planTabs.list.useQuery({ projectId }, { enabled: !!projectId });
  const createPlanTabMutation = trpc.planTabs.create.useMutation({
    onSuccess: (data) => {
      refetchPlanTabs();
      setActiveTabId(data.id);
      setAddTabDialogOpen(false);
      setNewTabName("");
      setNewTabFile(null);
      toast.success("Plan tab added");
    },
    onError: () => toast.error("Failed to add plan tab"),
  });
  const renamePlanTabMutation = trpc.planTabs.rename.useMutation({
    onSuccess: () => { refetchPlanTabs(); setRenamingTabId(null); },
  });
  const deletePlanTabMutation = trpc.planTabs.delete.useMutation({
    onSuccess: () => {
      refetchPlanTabs();
      setDeleteTabConfirmId(null);
      // If we deleted the active tab, go back to default
      setActiveTabId(prev => (prev === deleteTabConfirmId ? null : prev));
      toast.success("Plan tab deleted");
    },
    onError: () => toast.error("Failed to delete plan tab"),
  });
  const updatePlanTabStateMutation = trpc.planTabs.updateState.useMutation();

  const { data: measurements, isLoading: measurementsLoading } = trpc.measurements.list.useQuery(
    { projectId, tabId: activeTabId !== undefined ? activeTabId : null },
    { enabled: !!projectId }
  );
  // All measurements across all tabs — used for report generation
  const { data: allMeasurements = [] } = trpc.measurements.listAll.useQuery({ projectId }, { enabled: !!projectId });

  // Memoize category grouping — recomputed only when measurements change, not on every render
  const measurementsByCategory = useMemo(() => {
    if (!measurements) return {};
    return measurements.reduce((acc, m) => {
      if (!acc[m.name]) acc[m.name] = [];
      acc[m.name].push(m);
      return acc;
    }, {} as Record<string, typeof measurements>);
  }, [measurements]);
  const { data: textAnnotationsList = [] } = trpc.textAnnotations.list.useQuery(
    { projectId, tabId: activeTabId !== undefined ? activeTabId : null },
    { enabled: !!projectId }
  );
  const createTextAnnotationMutation = trpc.textAnnotations.create.useMutation({
    onSuccess: () => utils.textAnnotations.list.invalidate({ projectId, tabId: activeTabId !== undefined ? activeTabId : null }),
  });
  const updateTextAnnotationMutation = trpc.textAnnotations.update.useMutation({
    onSuccess: () => utils.textAnnotations.list.invalidate({ projectId, tabId: activeTabId !== undefined ? activeTabId : null }),
  });
  const deleteTextAnnotationMutation = trpc.textAnnotations.delete.useMutation({
    onSuccess: () => utils.textAnnotations.list.invalidate({ projectId, tabId: activeTabId !== undefined ? activeTabId : null }),
  });
  // ─── Cutout queries ───────────────────────────────────────────────────────────
  const { data: cutoutsList = [] } = trpc.cutouts.list.useQuery(
    { projectId, tabId: activeTabId !== undefined ? activeTabId : null },
    { enabled: !!projectId }
  );
  const createCutoutMutation = trpc.cutouts.create.useMutation({
    onSuccess: () => {
      utils.cutouts.list.invalidate({ projectId, tabId: activeTabId !== undefined ? activeTabId : null });
      setIsCutoutMode(false); setCutoutParentId(null); setCurrentPolygon([]); setIsDrawing(false);
      toast.success("Cutout saved");
    },
  });
  const deleteCutoutMutation = trpc.cutouts.delete.useMutation({
    onSuccess: () => utils.cutouts.list.invalidate({ projectId, tabId: activeTabId !== undefined ? activeTabId : null }),
  });

  // ─── Dimension Line queries ───────────────────────────────────────────────────
  const { data: dimensionLinesList = [] } = trpc.dimensionLines.list.useQuery(
    { projectId, tabId: activeTabId !== undefined ? activeTabId : null },
    { enabled: !!projectId }
  );
  const createDimensionLineMutation = trpc.dimensionLines.create.useMutation({
    onSuccess: () => {
      utils.dimensionLines.list.invalidate({ projectId, tabId: activeTabId !== undefined ? activeTabId : null });
      setIsDimMode(false); setDimStep(0); setDimPoint1(null); setDimPoint2(null); setDimOffsetPx(40);
      toast.success("Dimension line saved");
    },
  });
  const deleteDimensionLineMutation = trpc.dimensionLines.delete.useMutation({
    onSuccess: () => utils.dimensionLines.list.invalidate({ projectId, tabId: activeTabId !== undefined ? activeTabId : null }),
  });

  // ─── Callout queries ──────────────────────────────────────────────────────────
  const { data: calloutsList = [] } = trpc.callouts.list.useQuery(
    { projectId, tabId: activeTabId !== undefined ? activeTabId : null },
    { enabled: !!projectId }
  );
  const createCalloutMutation = trpc.callouts.create.useMutation({
    onSuccess: () => {
      utils.callouts.list.invalidate({ projectId, tabId: activeTabId !== undefined ? activeTabId : null });
      setIsCalloutMode(false); setCalloutStep(0); setCalloutAnchor(null);
      toast.success("Callout saved");
    },
  });
  const updateCalloutMutation = trpc.callouts.update.useMutation({
    onSuccess: () => utils.callouts.list.invalidate({ projectId, tabId: activeTabId !== undefined ? activeTabId : null }),
  });
  const deleteCalloutMutation = trpc.callouts.delete.useMutation({
    onSuccess: () => {
      utils.callouts.list.invalidate({ projectId, tabId: activeTabId !== undefined ? activeTabId : null });
      setSelectedCalloutId(null);
    },
  });
  const renderedCallouts = useMemo(
    () => calloutsList.map(callout => ({ ...callout, ...calloutDrafts[callout.id] })),
    [calloutsList, calloutDrafts],
  );
  useEffect(() => {
    renderedCalloutsRef.current = renderedCallouts;
  }, [renderedCallouts]);
  const getCalloutHit = useCallback((canvasX: number, canvasY: number) => {
    const x = canvasX / zoomLevel;
    const y = canvasY / zoomLevel;
    const anchorRadius = Math.max(8, 12 / zoomLevel);
    for (const callout of [...renderedCallouts].reverse()) {
      if (Math.hypot(x - callout.anchorX, y - callout.anchorY) <= anchorRadius) return { callout, part: 'anchor' as const };
      const inBubble = x >= callout.bubbleX && x <= callout.bubbleX + callout.bubbleW && y >= callout.bubbleY && y <= callout.bubbleY + callout.bubbleH;
      if (inBubble) return { callout, part: 'bubble' as const };
    }
    return null;
  }, [renderedCallouts, zoomLevel]);

  const updateProjectMutation = trpc.projects.update.useMutation({
    onSuccess: () => {
      utils.projects.get.invalidate({ id: projectId });
      toast.success("Project updated");
      setEditingProjectName(false);
    },
  });

  const createMeasurementMutation = trpc.measurements.create.useMutation({
    onSuccess: (data) => {
      // Track the newly created measurement ID so Ctrl+Z can undo it
      if (data && typeof data.id === 'number') {
        lastSavedMeasurementIdRef.current = data.id;
      }
      utils.measurements.list.invalidate({ projectId, tabId: activeTabId !== undefined ? activeTabId : null });
      utils.measurements.listAll.invalidate({ projectId });
      toast.success("Measurement saved — Ctrl+Z to undo");
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
      utils.measurements.list.invalidate({ projectId, tabId: activeTabId !== undefined ? activeTabId : null });
      utils.measurements.listAll.invalidate({ projectId });
      toast.success("Measurement updated");
      redrawOverlay();
    },
  });

  const tabIdKey = activeTabId !== undefined ? activeTabId : null;
  const deleteMeasurementMutation = trpc.measurements.delete.useMutation({
    // Optimistic update: remove from cache immediately for instant feedback
    onMutate: async (variables) => {
      await utils.measurements.list.cancel({ projectId, tabId: tabIdKey });
      const previous = utils.measurements.list.getData({ projectId, tabId: tabIdKey });
      utils.measurements.list.setData(
        { projectId, tabId: tabIdKey },
        (old) => old?.filter((m) => m.id !== variables.id) ?? old
      );
      return { previous };
    },
    onError: (_err, _variables, context) => {
      // Rollback on error
      if (context?.previous) {
        utils.measurements.list.setData({ projectId, tabId: tabIdKey }, context.previous);
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
      utils.measurements.list.invalidate({ projectId, tabId: tabIdKey });
      utils.measurements.listAll.invalidate({ projectId });
    },
  });

  // Load PDF — loads the active tab's PDF if a tab is active, otherwise the project PDF
  useEffect(() => {
    // Determine which PDF URL and scale to use
    const activeTab = activeTabId !== null ? planTabsList.find(t => t.id === activeTabId) : null;
    const pdfUrl = activeTab ? activeTab.pdfUrl : project?.pdfUrl;
    if (!pdfUrl) return;

    const loadPdf = async () => {
      try {
        const loadingTask = pdfjsLib.getDocument({
          url: pdfUrl,
          withCredentials: false,
          isEvalSupported: false,
          httpHeaders: { 'Accept': 'application/pdf' },
          useSystemFonts: true,
          standardFontDataUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/standard_fonts/',
        });
        const pdf = await loadingTask.promise;
        setPdfDoc(pdf);
        // Load scale from active tab or project
        if (activeTab) {
          setScale(parseFloat(activeTab.scale || "1.0"));
          setScaleUnit(activeTab.scaleUnit || "ft");
          setCurrentPage(activeTab.currentPage || 1);
        } else {
          setScale(parseFloat(project?.scale || "1.0"));
          setScaleUnit(project?.scaleUnit || "ft");
        }
        setNotes(project?.notes || "");
        setNewProjectName(project?.name || "");
      } catch (error) {
        console.error("Error loading PDF:", error);
        toast.error(
          `Unable to load PDF. The file may have expired or been moved. Please try uploading the PDF again.`,
          { duration: 10000 }
        );
      }
    };

    loadPdf();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, activeTabId, planTabsList]);

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
    const optimalZoom = Math.max(0.1, Math.min(3.0, Math.min(zoomToFitWidth, zoomToFitHeight)));
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

    // Cancel any in-flight render from a previous zoom level
    renderCancelRef.current.cancelled = true;
    const token = { cancelled: false };
    renderCancelRef.current = token;

    const renderPage = async () => {
      try {
        const page = await pdfDoc.getPage(currentPage);
        if (token.cancelled) return;

        const canvas = canvasRef.current;
        if (!canvas) return;

        // High quality rendering: base scale 2.5 for crisp text, multiplied by zoom level
        const rawViewport = page.getViewport({ scale: baseScale * zoomLevel });

        // ── Canvas size guard — prevent GPU context loss at extreme zoom ──
        // Browsers silently lose the 2D context when canvas dimensions exceed ~8 192 px.
        // If the desired viewport exceeds MAX_CANVAS_PX, we render at a capped size and
        // apply a CSS scale transform so the visual result is identical.
        const rawW = rawViewport.width;
        const rawH = rawViewport.height;
        const clampRatio = Math.min(1, MAX_CANVAS_PX / Math.max(rawW, rawH));
        const renderScale = baseScale * zoomLevel * clampRatio;
        const viewport = clampRatio < 1
          ? page.getViewport({ scale: renderScale })
          : rawViewport;

        if (token.cancelled) return;

        // Set canvas size to the (possibly clamped) viewport
        canvas.width  = viewport.width;
        canvas.height = viewport.height;

        // Apply CSS scale to compensate for clamped render so it fills the same visual space
        if (clampRatio < 1) {
          const cssScale = 1 / clampRatio;
          canvas.style.transform = `scale(${cssScale})`;
          canvas.style.transformOrigin = "top left";
        } else {
          canvas.style.transform = "";
          canvas.style.transformOrigin = "";
        }

        if (overlayCanvasRef.current) {
          overlayCanvasRef.current.width  = viewport.width;
          overlayCanvasRef.current.height = viewport.height;
          if (clampRatio < 1) {
            const cssScale = 1 / clampRatio;
            overlayCanvasRef.current.style.transform = `scale(${cssScale})`;
            overlayCanvasRef.current.style.transformOrigin = "top left";
          } else {
            overlayCanvasRef.current.style.transform = "";
            overlayCanvasRef.current.style.transformOrigin = "";
          }
        }

        const context = canvas.getContext("2d");
        if (!context) {
          toast.error("Canvas context unavailable — please zoom out for better performance", { id: "canvas-ctx-err" });
          return;
        }

        // Enable image smoothing for better quality
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";

        if (token.cancelled) return;

        // Start the render task so we can cancel it if needed
        const renderTask = page.render({ canvasContext: context, viewport, canvas });
        // Store cancel function on token so the cleanup can abort it
        (token as any).cancelRender = () => renderTask.cancel();
        await renderTask.promise;
        if (token.cancelled) return;
        redrawOverlay();
      } catch (err) {
        // Suppress expected cancellation errors — these happen on every zoom change
        // when the previous render is interrupted by the next one.
        // PDF.js throws RenderingCancelledException; we also check token.cancelled
        // for any other error that occurs after the render was superseded.
        if (token.cancelled) return;
        const errName = (err as any)?.name ?? "";
        const errMsg  = (err as any)?.message ?? "";
        if (
          errName === "RenderingCancelledException" ||
          errName === "AbortException" ||
          errMsg.includes("Rendering cancelled") ||
          errMsg.includes("Worker was destroyed")
        ) {
          return; // Normal interruption — not an error
        }
        console.error("PDF render error:", err);
        toast.error("Render failed — try zooming out or reloading the page", { id: "pdf-render-err" });
      }
    };

    renderPage();

    // Cleanup: cancel the in-flight render when the effect re-runs or the component unmounts
    return () => {
      token.cancelled = true;
      if ((token as any).cancelRender) (token as any).cancelRender();
    };
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

        // Cancel new annotation tools
        if (isRectMode) { setIsRectMode(false); setRectFirstPoint(null); toast('Rectangle cancelled'); return; }
        if (isDimMode) { setIsDimMode(false); setDimStep(0); setDimPoint1(null); setDimPoint2(null); toast('Dimension cancelled'); return; }
        if (isCalloutMode) { setIsCalloutMode(false); setCalloutStep(0); setCalloutAnchor(null); toast('Callout cancelled'); return; }
        // In cutout mode with 0 points: cancel. With 2+ points: save (fall through to name dialog below)
        if (isCutoutMode && currentPolygon.length < 2) { setIsCutoutMode(false); setCutoutParentId(null); setIsDrawing(false); setCurrentPolygon([]); toast('Cutout cancelled'); return; }
        // If isCutoutMode with 2+ points, fall through to the name dialog open below
        
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

      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedCalloutId !== null) {
        const tag = (e.target as HTMLElement).tagName;
        if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
          e.preventDefault();
          if (confirm('Delete this label?')) {
            deleteCalloutMutation.mutate({ id: selectedCalloutId, projectId });
            toast.success('Label deleted');
          }
          return;
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

      // Ctrl+Z — undo last saved measurement (delete it)
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        // Don't intercept if typing in an input/textarea
        const tag = (e.target as HTMLElement).tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        e.preventDefault();
        const lastId = lastSavedMeasurementIdRef.current;
        if (lastId !== null) {
          deleteMeasurementMutation.mutate({ id: lastId });
          lastSavedMeasurementIdRef.current = null; // consume — only one level of undo
        } else {
          toast.error('Nothing to undo');
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isDrawing, currentPolygon, isEditMode, selectedMeasurementId, selectedCalloutId, isCountingMode, handleFitToScreen, deleteMeasurementMutation, deleteCalloutMutation, projectId]);

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

      const calloutHit = !isDrawing && !isCountingMode && !isTextMode && !isRectMode && !isDimMode && !isCalloutMode && !isCutoutMode
        ? findCalloutHitFromRef(x, y)
        : null;
      if (calloutHit) {
        setSelectedCalloutId(calloutHit.callout.id);
        calloutTouchDragRef.current = {
          id: calloutHit.callout.id,
          part: calloutHit.part,
          startX: touch.clientX,
          startY: touch.clientY,
          origX: calloutHit.part === 'bubble' ? calloutHit.callout.bubbleX : calloutHit.callout.anchorX,
          origY: calloutHit.part === 'bubble' ? calloutHit.callout.bubbleY : calloutHit.callout.anchorY,
        };
        touchStartRef.current = { x: touch.clientX, y: touch.clientY };
        setIsPanning(false);
      } else if (isDrawing || isCountingMode || isTextMode || isRectMode || isDimMode || isCalloutMode || isCutoutMode) {
        // In drawing/counting mode: single tap will be handled by touchEnd (tap detection)
        touchStartRef.current = { x: touch.clientX, y: touch.clientY };
      } else {
        // Not drawing: start panning
        touchStartRef.current = { x: touch.clientX, y: touch.clientY };
        setIsPanning(true);
        setPanStart({ x: touch.clientX, y: touch.clientY });
      }
    }
  }, [isDrawing, isCountingMode, isTextMode, isRectMode, isDimMode, isCalloutMode, isCutoutMode]);

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
          const newZoom = Math.max(0.1, Math.min(3.0, prev * scaleFactor));
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

      const calloutDrag = calloutTouchDragRef.current;
      if (calloutDrag) {
        const dx = (touch.clientX - calloutDrag.startX) / zoomLevelRef.current;
        const dy = (touch.clientY - calloutDrag.startY) / zoomLevelRef.current;
        updateCalloutDraft(calloutDrag.id, calloutDrag.part === 'bubble'
          ? { bubbleX: calloutDrag.origX + dx, bubbleY: calloutDrag.origY + dy }
          : { anchorX: calloutDrag.origX + dx, anchorY: calloutDrag.origY + dy });
        return;
      }

      if (isPanning && panStart) {
        const dx = touch.clientX - panStart.x;
        const dy = touch.clientY - panStart.y;
        const newPanTouch = { x: panOffsetRef.current.x + dx, y: panOffsetRef.current.y + dy };
        panOffsetRef.current = newPanTouch;
        setPanOffset(newPanTouch);
        setPanStart({ x: touch.clientX, y: touch.clientY });
      }

      if (isDrawing || isRectMode || isDimMode || isCalloutMode || isCutoutMode) {
        setCursorPosition({ x, y });
      }
    }
  }, [isPanning, panStart, panOffset, isDrawing, isRectMode, isDimMode, isCalloutMode, isCutoutMode]);

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

      const calloutDrag = calloutTouchDragRef.current;
      if (calloutDrag) {
        const dx = Math.abs(changedTouch.clientX - calloutDrag.startX);
        const dy = Math.abs(changedTouch.clientY - calloutDrag.startY);
        if (dx < 10 && dy < 10) {
          const previousTap = lastCalloutTapRef.current;
          if (previousTap?.id === calloutDrag.id && Date.now() - previousTap.at < 550) {
            const callout = renderedCalloutsRef.current.find(item => item.id === calloutDrag.id);
            if (callout) {
              setEditingCalloutId(callout.id);
              setEditingCalloutText(callout.text);
            }
            lastCalloutTapRef.current = null;
          } else {
            lastCalloutTapRef.current = { id: calloutDrag.id, at: Date.now() };
          }
        } else {
          const updates = calloutDraftsRef.current[calloutDrag.id];
          if (updates) {
            updateCalloutMutation.mutate({ id: calloutDrag.id, projectId, ...updates }, {
              onSuccess: () => setCalloutDrafts(previous => {
                const { [calloutDrag.id]: _saved, ...remaining } = previous;
                calloutDraftsRef.current = remaining;
                return remaining;
              }),
            });
          }
        }
        calloutTouchDragRef.current = null;
      } else if (startPos) {
        const dx = Math.abs(changedTouch.clientX - startPos.x);
        const dy = Math.abs(changedTouch.clientY - startPos.y);
        const isTap = dx < 10 && dy < 10; // small movement = tap

        if (isTap && (isDrawing || isCountingMode || isTextMode || isRectMode || isDimMode || isCalloutMode || isCutoutMode)) {
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
  }, [isDrawing, isCountingMode, isTextMode, isRectMode, isDimMode, isCalloutMode, isCutoutMode, projectId]);
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
      doRedrawRef.current(); // always calls the latest version — no stale closure
    });
  }, []);

  const _doRedrawOverlay = () => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return; // GPU context lost (e.g. canvas too large) — skip silently
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
        // Draw area measurement (polygon), with cutout holes punched via offscreen canvas
        const myCutouts = cutoutsList.filter((c: Cutout) => c.parentMeasurementId === measurement.id);

        if (myCutouts.length > 0) {
          // Use an offscreen canvas so destination-out only affects this shape, not other measurements
          const overlayCanvas = overlayCanvasRef.current!;
          const offscreen = document.createElement('canvas');
          offscreen.width = overlayCanvas.width;
          offscreen.height = overlayCanvas.height;
          const offCtx = offscreen.getContext('2d')!;

          // 1. Draw the filled area on the offscreen canvas
          offCtx.fillStyle = measurement.color + (isSelected ? "60" : "40");
          offCtx.beginPath();
          offCtx.moveTo(scaledCoords[0].x, scaledCoords[0].y);
          scaledCoords.forEach((point) => offCtx.lineTo(point.x, point.y));
          offCtx.closePath();
          offCtx.fill();

          // 2. Punch holes for each cutout using destination-out
          offCtx.globalCompositeOperation = 'destination-out';
          offCtx.globalAlpha = 1;
          myCutouts.forEach((cutout: Cutout) => {
            const cc = (cutout.coordinates as Point[]).map((p: Point) => ({ x: p.x * zoomLevel, y: p.y * zoomLevel }));
            if (cc.length < 3) return;
            offCtx.beginPath();
            offCtx.moveTo(cc[0].x, cc[0].y);
            cc.forEach((p: Point) => offCtx.lineTo(p.x, p.y));
            offCtx.closePath();
            offCtx.fill();
          });
          offCtx.globalCompositeOperation = 'source-over';

          // 3. Composite the offscreen canvas onto the main overlay
          ctx.drawImage(offscreen, 0, 0);

          // 4. Draw the outer border
          ctx.strokeStyle = isSelected ? "#22c55e" : measurement.color;
          ctx.lineWidth = isSelected ? 4 : 2;
          ctx.beginPath();
          ctx.moveTo(scaledCoords[0].x, scaledCoords[0].y);
          scaledCoords.forEach((point) => ctx.lineTo(point.x, point.y));
          ctx.closePath();
          ctx.stroke();

          // 5. Draw cutout borders (red dashed) so they are visible
          myCutouts.forEach((cutout: Cutout) => {
            const cc = (cutout.coordinates as Point[]).map((p: Point) => ({ x: p.x * zoomLevel, y: p.y * zoomLevel }));
            if (cc.length < 3) return;
            ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
            ctx.beginPath(); ctx.moveTo(cc[0].x, cc[0].y);
            cc.forEach((p: Point) => ctx.lineTo(p.x, p.y)); ctx.closePath(); ctx.stroke();
            ctx.setLineDash([]);
          });

          // 6. Draw area label on each cutout (name + area, centered at centroid)
          myCutouts.forEach((cutout: Cutout) => {
            const cc = (cutout.coordinates as Point[]).map((p: Point) => ({ x: p.x * zoomLevel, y: p.y * zoomLevel }));
            if (cc.length < 3) return;
            const cx = cc.reduce((s, p) => s + p.x, 0) / cc.length;
            const cy = cc.reduce((s, p) => s + p.y, 0) / cc.length;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.lineJoin = 'round';
            // Name label
            ctx.font = 'bold 10px sans-serif';
            ctx.lineWidth = 3;
            ctx.strokeStyle = 'rgba(0,0,0,0.85)';
            ctx.strokeText(cutout.name, cx, cy - 7);
            ctx.fillStyle = '#ef4444';
            ctx.fillText(cutout.name, cx, cy - 7);
            // Area label
            ctx.font = '9px sans-serif';
            const cutoutArea = parseFloat(String(cutout.area));
            const cutoutAreaLabel = `−${cutoutArea.toFixed(1)} ${scaleUnit}²`;
            ctx.strokeStyle = 'rgba(0,0,0,0.85)';
            ctx.strokeText(cutoutAreaLabel, cx, cy + 7);
            ctx.fillStyle = '#ef4444';
            ctx.fillText(cutoutAreaLabel, cx, cy + 7);
          });
        } else {
          // No cutouts — draw normally
          ctx.fillStyle = measurement.color + (isSelected ? "60" : "40");
          ctx.strokeStyle = isSelected ? "#22c55e" : measurement.color;
          ctx.lineWidth = isSelected ? 4 : 2;
          ctx.beginPath();
          ctx.moveTo(scaledCoords[0].x, scaledCoords[0].y);
          scaledCoords.forEach((point) => ctx.lineTo(point.x, point.y));
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }

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
        // Show net area if cutouts exist, otherwise gross area
        const myCutoutsForLabel = cutoutsList.filter((c: Cutout) => c.parentMeasurementId === measurement.id);
        const cutoutTotal = myCutoutsForLabel.reduce((sum: number, c: Cutout) => sum + parseFloat(String(c.area)), 0);
        const grossArea = parseFloat(String(measurement.area));
        const netArea = Math.max(0, grossArea - cutoutTotal);
        const areaLabel = myCutoutsForLabel.length > 0
          ? `Net: ${netArea.toFixed(1)} ${scaleUnit}²`
          : `${measurement.area} ${scaleUnit}²`;
        ctx.strokeText(areaLabel, centerX, centerY + 7);
        ctx.fillStyle = "#fff";
        ctx.fillText(areaLabel, centerX, centerY + 7);
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

    // Draw cutouts (hatched polygons with dashed red border)
    // Draw saved dimension lines
    dimensionLinesList.forEach((dim: DimensionLine) => {
      const dist = calculateDistance({ x: dim.x1, y: dim.y1 }, { x: dim.x2, y: dim.y2 });
      const label = dim.customLabel || `${dist.toFixed(2)} ${scaleUnit}`;
      drawDimensionLineOnCanvas(ctx, dim.x1, dim.y1, dim.x2, dim.y2, dim.offsetPx, label, dim.color, zoomLevel);
    });

    // Draw saved callout bubbles
    renderedCallouts.forEach((callout: Callout) => {
      drawCalloutOnCanvas(ctx, callout.anchorX, callout.anchorY, callout.bubbleX, callout.bubbleY,
        callout.bubbleW, callout.bubbleH, callout.text, callout.color, callout.textColor,
        zoomLevel, selectedCalloutId === callout.id);
    });

    // Draw in-progress dimension line preview
    if (isDimMode && dimPoint1 && cursorPosition) {
      if (dimStep === 1) {
        const p2n = { x: cursorPosition.x / zoomLevel, y: cursorPosition.y / zoomLevel };
        const dist = calculateDistance(dimPoint1, p2n);
        drawDimensionLineOnCanvas(ctx, dimPoint1.x, dimPoint1.y, p2n.x, p2n.y, dimOffsetPx, `${dist.toFixed(2)} ${scaleUnit}`, dimColor, zoomLevel);
      } else if (dimStep === 2 && dimPoint2) {
        const dist = calculateDistance(dimPoint1, dimPoint2);
        drawDimensionLineOnCanvas(ctx, dimPoint1.x, dimPoint1.y, dimPoint2.x, dimPoint2.y, dimOffsetPx, `${dist.toFixed(2)} ${scaleUnit}`, dimColor, zoomLevel);
      }
    }

    // Draw in-progress callout preview
    if (isCalloutMode && calloutStep === 1 && calloutAnchor && cursorPosition) {
      const axp = calloutAnchor.x * zoomLevel; const ayp = calloutAnchor.y * zoomLevel;
      ctx.save(); ctx.strokeStyle = '#374151'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(axp, ayp); ctx.lineTo(cursorPosition.x, cursorPosition.y); ctx.stroke();
      ctx.setLineDash([]); ctx.fillStyle = '#374151';
      ctx.beginPath(); ctx.arc(axp, ayp, 5, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }

    // Draw in-progress rectangle preview
    if (isRectMode && rectFirstPoint && cursorPosition) {
      const p1s = { x: rectFirstPoint.x * zoomLevel, y: rectFirstPoint.y * zoomLevel };
      ctx.save(); ctx.strokeStyle = selectedColor; ctx.lineWidth = 2; ctx.setLineDash([5, 5]);
      ctx.fillStyle = selectedColor + '30';
      ctx.beginPath(); ctx.rect(p1s.x, p1s.y, cursorPosition.x - p1s.x, cursorPosition.y - p1s.y);
      ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
      const rw = calculateDistance(rectFirstPoint, { x: cursorPosition.x / zoomLevel, y: rectFirstPoint.y });
      const rh = calculateDistance(rectFirstPoint, { x: rectFirstPoint.x, y: cursorPosition.y / zoomLevel });
      ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.lineWidth = 3; ctx.lineJoin = 'round';
      const rmx = (p1s.x + cursorPosition.x) / 2; const rmy = (p1s.y + cursorPosition.y) / 2;
      ctx.strokeText(`${rw.toFixed(1)} × ${rh.toFixed(1)} ${scaleUnit}`, rmx, rmy);
      ctx.fillStyle = selectedColor;
      ctx.fillText(`${rw.toFixed(1)} × ${rh.toFixed(1)} ${scaleUnit}`, rmx, rmy);
      ctx.restore();
    }

    // Draw crosshair cursor
    if ((isDrawing || isCalibrating || isRectMode || isDimMode || isCalloutMode || isCutoutMode) && cursorPosition) {
      // Snap detection: 10px threshold as specified
      const snapPoint = isDrawing ? findSnapPoint(cursorPosition.x, cursorPosition.y, 10) : null;
      const isNearSnapPoint = snapPoint !== null;

      // When snapping, move the crosshair center to the exact snap point
      const crosshairX = isNearSnapPoint && snapPoint
        ? snapPoint.x * zoomLevel
        : cursorPosition.x;
      const crosshairY = isNearSnapPoint && snapPoint
        ? snapPoint.y * zoomLevel
        : cursorPosition.y;

      ctx.strokeStyle = isNearSnapPoint ? "rgba(34, 197, 94, 1.0)" : "rgba(0, 0, 0, 0.8)";
      ctx.lineWidth = isNearSnapPoint ? 1.5 : 1;
      ctx.setLineDash([]);

      // Horizontal crosshair line
      ctx.beginPath();
      ctx.moveTo(0, crosshairY);
      ctx.lineTo(canvas.width, crosshairY);
      ctx.stroke();

      // Vertical crosshair line
      ctx.beginPath();
      ctx.moveTo(crosshairX, 0);
      ctx.lineTo(crosshairX, canvas.height);
      ctx.stroke();

      // Center circle
      ctx.beginPath();
      ctx.arc(crosshairX, crosshairY, isNearSnapPoint ? 10 : 8, 0, Math.PI * 2);
      ctx.lineWidth = isNearSnapPoint ? 2.5 : 1;
      ctx.stroke();

      // Snap indicator: filled green circle + outer ring + "SNAP" label at the target vertex
      if (isNearSnapPoint && snapPoint) {
        const sx = snapPoint.x * zoomLevel;
        const sy = snapPoint.y * zoomLevel;

        // Outer pulsing ring
        ctx.strokeStyle = "rgba(34, 197, 94, 0.9)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(sx, sy, 16, 0, Math.PI * 2);
        ctx.stroke();

        // Filled inner circle
        ctx.fillStyle = "rgba(34, 197, 94, 0.5)";
        ctx.beginPath();
        ctx.arc(sx, sy, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(34, 197, 94, 1.0)";
        ctx.lineWidth = 2;
        ctx.stroke();

        // "SNAP" label above the indicator
        ctx.font = "bold 11px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.strokeStyle = "rgba(0,0,0,0.8)";
        ctx.lineWidth = 3;
        ctx.lineJoin = "round";
        ctx.strokeText("SNAP", sx, sy - 18);
        ctx.fillStyle = "rgba(34, 197, 94, 1.0)";
        ctx.fillText("SNAP", sx, sy - 18);
      }
    }
  };
  // Keep the ref pointing to the latest _doRedrawOverlay on every render
  // This is what breaks the stale closure: redrawOverlay (useCallback []) always calls doRedrawRef.current,
  // which is updated here on every render to the freshest closure with current state values.
  doRedrawRef.current = _doRedrawOverlay;

  // ─── Helper: draw a dimension line on canvas ──────────────────────────────────
  const drawDimensionLineOnCanvas = (
    ctx: CanvasRenderingContext2D,
    x1: number, y1: number, x2: number, y2: number,
    offsetPx: number, label: string, color: string, zoom: number
  ) => {
    const p1 = { x: x1 * zoom, y: y1 * zoom };
    const p2 = { x: x2 * zoom, y: y2 * zoom };
    const dx = p2.x - p1.x; const dy = p2.y - p1.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) return;
    const nx = -dy / len; const ny = dx / len;
    const off = offsetPx * zoom;
    const op1 = { x: p1.x + nx * off, y: p1.y + ny * off };
    const op2 = { x: p2.x + nx * off, y: p2.y + ny * off };
    const mid = { x: (op1.x + op2.x) / 2, y: (op1.y + op2.y) / 2 };
    const arrowLen = 10 * zoom; const extLen = 8 * zoom;
    ctx.save();
    ctx.strokeStyle = color; ctx.fillStyle = color;
    ctx.lineWidth = Math.max(1, 1.5 * zoom); ctx.setLineDash([]);
    // Extension lines
    ctx.beginPath(); ctx.moveTo(p1.x + nx * 4 * zoom, p1.y + ny * 4 * zoom); ctx.lineTo(op1.x + nx * extLen, op1.y + ny * extLen); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(p2.x + nx * 4 * zoom, p2.y + ny * 4 * zoom); ctx.lineTo(op2.x + nx * extLen, op2.y + ny * extLen); ctx.stroke();
    // Main line
    ctx.beginPath(); ctx.moveTo(op1.x, op1.y); ctx.lineTo(op2.x, op2.y); ctx.stroke();
    // Arrowheads
    const ldx = op2.x - op1.x; const ldy = op2.y - op1.y;
    const ll = Math.sqrt(ldx * ldx + ldy * ldy);
    if (ll > 0) {
      const ux = ldx / ll; const uy = ldy / ll;
      ctx.beginPath(); ctx.moveTo(op1.x, op1.y);
      ctx.lineTo(op1.x + ux * arrowLen - uy * arrowLen * 0.4, op1.y + uy * arrowLen + ux * arrowLen * 0.4);
      ctx.lineTo(op1.x + ux * arrowLen + uy * arrowLen * 0.4, op1.y + uy * arrowLen - ux * arrowLen * 0.4);
      ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(op2.x, op2.y);
      ctx.lineTo(op2.x - ux * arrowLen - uy * arrowLen * 0.4, op2.y - uy * arrowLen + ux * arrowLen * 0.4);
      ctx.lineTo(op2.x - ux * arrowLen + uy * arrowLen * 0.4, op2.y - uy * arrowLen - ux * arrowLen * 0.4);
      ctx.closePath(); ctx.fill();
    }
    // Label
    const fontSize = Math.max(9, 11 * zoom);
    ctx.font = `bold ${fontSize}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const loff = (fontSize + 4) * (offsetPx >= 0 ? 1 : -1);
    const lx = mid.x + nx * loff; const ly = mid.y + ny * loff;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 3; ctx.lineJoin = 'round';
    ctx.strokeText(label, lx, ly); ctx.fillStyle = color; ctx.fillText(label, lx, ly);
    ctx.restore();
  };

  // ─── Helper: draw a callout bubble on canvas ──────────────────────────────────
  const drawCalloutOnCanvas = (
    ctx: CanvasRenderingContext2D,
    anchorX: number, anchorY: number,
    bubbleX: number, bubbleY: number,
    bubbleW: number, bubbleH: number,
    text: string, color: string, textColor: string,
    zoom: number, isSelected: boolean
  ) => {
    const ax = anchorX * zoom; const ay = anchorY * zoom;
    const bx = bubbleX * zoom; const by = bubbleY * zoom;
    const bw = bubbleW * zoom; const bh = bubbleH * zoom;
    const r = Math.min(8 * zoom, bw / 4, bh / 4);
    ctx.save();
    // Leader line
    ctx.strokeStyle = isSelected ? '#3b82f6' : '#374151';
    ctx.lineWidth = Math.max(1.5, 2 * zoom); ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx + bw / 2, by + bh / 2); ctx.stroke();
    // Anchor dot
    ctx.fillStyle = isSelected ? '#3b82f6' : '#374151';
    ctx.beginPath(); ctx.arc(ax, ay, Math.max(4, 5 * zoom), 0, Math.PI * 2); ctx.fill();
    // Bubble background
    ctx.fillStyle = color; ctx.strokeStyle = isSelected ? '#3b82f6' : '#374151';
    ctx.lineWidth = isSelected ? Math.max(2, 2.5 * zoom) : Math.max(1, 1.5 * zoom);
    ctx.beginPath();
    ctx.moveTo(bx + r, by); ctx.lineTo(bx + bw - r, by);
    ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + r);
    ctx.lineTo(bx + bw, by + bh - r);
    ctx.quadraticCurveTo(bx + bw, by + bh, bx + bw - r, by + bh);
    ctx.lineTo(bx + r, by + bh);
    ctx.quadraticCurveTo(bx, by + bh, bx, by + bh - r);
    ctx.lineTo(bx, by + r);
    ctx.quadraticCurveTo(bx, by, bx + r, by);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // Text
    const padding = 8 * zoom; const fontSize = Math.max(9, 11 * zoom);
    ctx.fillStyle = textColor; ctx.font = `${fontSize}px sans-serif`;
    ctx.textBaseline = 'top'; ctx.textAlign = 'left';
    ctx.save();
    ctx.beginPath(); ctx.rect(bx + padding, by + padding, bw - padding * 2, bh - padding * 2); ctx.clip();
    const words = text.split(' '); let line = ''; let lineY = by + padding;
    const lineHeight = fontSize * 1.3;
    for (const word of words) {
      const testLine = line ? line + ' ' + word : word;
      if (ctx.measureText(testLine).width > bw - padding * 2 && line) {
        ctx.fillText(line, bx + padding, lineY); line = word; lineY += lineHeight;
        if (lineY + lineHeight > by + bh) break;
      } else { line = testLine; }
    }
    if (line) ctx.fillText(line, bx + padding, lineY);
    ctx.restore();
    if (isSelected) {
      const hSize = Math.max(8, 10 * zoom);
      ctx.fillStyle = '#3b82f6'; ctx.fillRect(bx + bw - hSize, by + bh - hSize, hSize, hSize);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.strokeRect(bx + bw - hSize, by + bh - hSize, hSize, hSize);
    }
    ctx.restore();
  };

  // Redraw when data or view state changes (NOT on every cursor move — that is handled via RAF in mousemove)
  // isDrawing and isCountingMode are included so entering/exiting drawing mode triggers a redraw immediately
  useEffect(() => {
    redrawOverlay();
  }, [measurements, currentPolygon, selectedColor, scale, scaleUnit, zoomLevel, isEditMode, selectedMeasurementId, draggingVertexIndex, isCalibrating, calibrationPoints, hiddenCategories, hiddenMeasurements, textAnnotationsList, selectedTextId, isTextMode, currentPage, isDrawing, isCountingMode, cutoutsList, dimensionLinesList, calloutsList, calloutDrafts, selectedCalloutId, isDimMode, dimPoint1, dimPoint2, dimStep, dimOffsetPx, dimColor, isCalloutMode, calloutStep, calloutAnchor, isRectMode, rectFirstPoint, isCutoutMode]);

  // Cursor-move redraws — only when actively drawing/counting (cheap path)
  // isDrawing/isCountingMode/isCalibrating included so the condition re-evaluates when modes change
  useEffect(() => {
    if (cursorPosition && (isDrawing || isCountingMode || isCalibrating || isRectMode || isDimMode || isCalloutMode || isCutoutMode)) {
      redrawOverlay();
    }
  }, [cursorPosition, isDrawing, isCountingMode, isCalibrating, isRectMode, isDimMode, isCalloutMode, isCutoutMode]);

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
    const newZoom = Math.max(0.1, Math.min(3.0, currentZoom + delta));
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
    const newZoom = Math.max(0.1, Math.min(3.0, currentZoom * factor));
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

    // If in dim step 2 (setting offset), use scroll to adjust offset instead of zooming
    if (isDimMode && dimStep === 2) {
      const offsetDelta = e.deltaY > 0 ? -5 : 5;
      setDimOffsetPx(prev => prev + offsetDelta);
      return;
    }

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

    // Callout labels take priority over canvas panning. Drag the bubble to reposition
    // the label, or drag the anchor dot to move the leader-line target.
    if (!isDrawing && !isTextMode && !isRectMode && !isDimMode && !isCalloutMode && !isCutoutMode) {
      const calloutHit = getCalloutHit(x, y);
      if (calloutHit) {
        setSelectedCalloutId(calloutHit.callout.id);
        setDraggingCalloutId(calloutHit.callout.id);
        setDraggingCalloutPart(calloutHit.part);
        setCalloutDragStart({
          mouseX: x,
          mouseY: y,
          origX: calloutHit.part === 'bubble' ? calloutHit.callout.bubbleX : calloutHit.callout.anchorX,
          origY: calloutHit.part === 'bubble' ? calloutHit.callout.bubbleY : calloutHit.callout.anchorY,
        });
        return;
      }
      if (selectedCalloutId !== null) setSelectedCalloutId(null);
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
    // Persist a completed callout drag as one database update instead of writing on every pointer move.
    if (draggingCalloutId !== null && draggingCalloutPart && calloutDragStart) {
      const updates = calloutDrafts[draggingCalloutId];
      if (updates) {
        updateCalloutMutation.mutate({ id: draggingCalloutId, projectId, ...updates }, {
          onSuccess: () => setCalloutDrafts(previous => {
            const { [draggingCalloutId]: _saved, ...remaining } = previous;
            return remaining;
          }),
        });
      }
      setDraggingCalloutId(null);
      setDraggingCalloutPart(null);
      setCalloutDragStart(null);
      return;
    }

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
    if (e.button !== 0) return; // Only left clicks
    const canvas = overlayCanvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const normalizedClickX = x / zoomLevel;
    const normalizedClickY = y / zoomLevel;

    // ─── Rectangle Area tool ─────────────────────────────────────────────────────
    if (isRectMode) {
      if (!rectFirstPoint) {
        setRectFirstPoint({ x: normalizedClickX, y: normalizedClickY });
      } else {
        const x1 = rectFirstPoint.x; const y1 = rectFirstPoint.y;
        const x2 = normalizedClickX; const y2 = normalizedClickY;
        const rectPoly = [{ x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 }];
        setCurrentPolygon(rectPoly);
        setIsShapeClosed(true);
        setRectFirstPoint(null);
        setIsRectMode(false);
        setIsDrawing(true);
        setIsNameDialogOpen(true);
      }
      return;
    }

    // ─── Dimension Line tool ─────────────────────────────────────────────────────
    if (isDimMode) {
      if (dimStep === 0) {
        setDimPoint1({ x: normalizedClickX, y: normalizedClickY });
        setDimStep(1);
      } else if (dimStep === 1) {
        setDimPoint2({ x: normalizedClickX, y: normalizedClickY });
        setDimStep(2);
        toast("Scroll up/down to adjust offset, then click to save", { duration: 3000 });
      } else if (dimStep === 2 && dimPoint1 && dimPoint2) {
        createDimensionLineMutation.mutate({
          projectId, tabId: activeTabId,
          x1: dimPoint1.x, y1: dimPoint1.y,
          x2: dimPoint2.x, y2: dimPoint2.y,
          offsetPx: dimOffsetPx, color: dimColor,
        });
      }
      return;
    }

    // ─── Callout Bubble tool ─────────────────────────────────────────────────────
    if (isCalloutMode) {
      if (calloutStep === 0) {
        setCalloutAnchor({ x: normalizedClickX, y: normalizedClickY });
        setCalloutStep(1);
        toast("Now click where to place the label bubble", { duration: 3000 });
      } else if (calloutStep === 1 && calloutAnchor) {
        const bubbleW = 160; const bubbleH = 60;
        createCalloutMutation.mutate({
          projectId, tabId: activeTabId,
          anchorX: calloutAnchor.x, anchorY: calloutAnchor.y,
          bubbleX: normalizedClickX - bubbleW / 2,
          bubbleY: normalizedClickY - bubbleH / 2,
          bubbleW, bubbleH, text: '',
          color: '#fef9c3', textColor: '#1e293b',
        }, {
          onSuccess: (data) => {
            setSelectedCalloutId(data.id);
            setEditingCalloutId(data.id);
            setEditingCalloutText('');
          },
        });
      }
      return;
    }

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
        tabId: activeTabId,
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
        tabId: activeTabId,
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

    // Check for snap to existing measurement points (10px threshold, consistent with visual indicator)
    const snapPoint = findSnapPoint(x, y, 10);
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

    if (isCutoutMode && cutoutParentId !== null) {
      // Save as a cutout subtraction from the parent measurement
      createCutoutMutation.mutate({
        projectId,
        tabId: activeTabId,
        parentMeasurementId: cutoutParentId,
        name: measurementName,
        area: area.toFixed(2),
        coordinates: currentPolygon,
      });
    } else {
      createMeasurementMutation.mutate({
        projectId,
        tabId: activeTabId,
        name: measurementName,
        type,
        color: selectedColor,
        area: area.toFixed(2),
        perimeter: perimeter ? perimeter.toFixed(2) : undefined,
        coordinates: currentPolygon,
      });
    }
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
      tabId: activeTabId,
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
    const allMeasurementsForExport = allMeasurements.length > 0 ? allMeasurements : (measurements ?? []);
    if (allMeasurementsForExport.length === 0) {
      toast.error("No measurements to export");
      return;
    }

    // Build tab name lookup: tabId -> tab name (null tabId = Plan 1)
    const defaultTabLabel = project?.defaultTabName || 'Plan 1';
    const tabNameMap: Record<string, string> = { 'null': defaultTabLabel };
    planTabsList.forEach(t => { tabNameMap[String(t.id)] = t.name; });

    // Group measurements by tab, then by category within each tab
    const groupedByTab: Record<string, Record<string, typeof allMeasurementsForExport>> = {};
    for (const m of allMeasurementsForExport) {
      const tabKey = m.tabId === null || m.tabId === undefined ? 'null' : String(m.tabId);
      const tabName = tabNameMap[tabKey] ?? `Plan ${tabKey}`;
      if (!groupedByTab[tabName]) groupedByTab[tabName] = {};
      if (!groupedByTab[tabName][m.name]) groupedByTab[tabName][m.name] = [];
      groupedByTab[tabName][m.name].push(m);
    }

    // For backward compat: also build flat grouped for annotated pages
    const grouped = allMeasurementsForExport.reduce((acc, m) => {
      if (!acc[m.name]) acc[m.name] = [];
      acc[m.name].push(m);
      return acc;
    }, {} as Record<string, typeof allMeasurementsForExport>);

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

      // Render categories grouped by tab
      const renderCategoryBlock = (categoryName: string, items: typeof allMeasurementsForExport) => {
        const isWallCat = WALL_CATEGORIES.includes(categoryName);
        const pointItems = items.filter(m => m.type === 'point' || (m.count !== null && m.count !== undefined && m.type !== 'line'));
        const lineItems = !isWallCat ? items.filter(m => m.type !== 'point' && (m.perimeter === null || m.perimeter === undefined)) : [];
        const areaItems = !isWallCat ? items.filter(m => m.type !== 'point' && m.perimeter !== null && m.perimeter !== undefined) : [];
        const totalCount = pointItems.length;
        const totalLinearFt = lineItems.reduce((sum, m) => sum + parseFloat(m.area || '0'), 0);
        const totalAreaSqFt = areaItems.reduce((sum, m) => sum + parseFloat(m.area || '0'), 0);
        const totalWallLinearFt = isWallCat ? items.reduce((sum, m) => sum + parseFloat(m.perimeter || '0'), 0) : 0;
        const totalWallArea = isWallCat ? items.reduce((sum, m) => sum + parseFloat(m.area || '0'), 0) : 0;
        if (yPos > 270) { doc.addPage(); yPos = 25; }
        doc.setFontSize(13);
        doc.setFont("helvetica", "bold");
        doc.text(categoryName, margin + 4, yPos);
        yPos += 7;
        doc.setFontSize(11);
        doc.setFont("helvetica", "normal");
        if (isWallCat) {
          doc.text(`Total Linear: ${totalWallLinearFt.toFixed(2)} ${scaleUnit}`, margin + 8, yPos); yPos += 7;
          doc.text(`Total Wall Area: ${totalWallArea.toFixed(2)} ${scaleUnit}\u00b2`, margin + 8, yPos); yPos += 7;
          items.forEach((m, idx) => {
            if (yPos > 270) { doc.addPage(); yPos = 25; }
            const height = m.count != null ? (m.count / 1000).toFixed(2) : '?';
            doc.setFontSize(9); doc.setFont("helvetica", "normal"); doc.setTextColor(80, 80, 80);
            doc.text(`  Segment ${idx + 1}: ${m.perimeter} ${scaleUnit} \u00d7 ${height} ${scaleUnit} h = ${m.area} ${scaleUnit}\u00b2`, margin + 8, yPos);
            doc.setTextColor(0, 0, 0); yPos += 6;
          });
        } else {
          if (totalCount > 0) { doc.text(`Count: ${totalCount} item${totalCount === 1 ? '' : 's'}`, margin + 8, yPos); yPos += 7; }
          if (totalLinearFt > 0) { doc.text(`Total: ${totalLinearFt.toFixed(2)} ${scaleUnit}`, margin + 8, yPos); yPos += 7; }
          if (totalAreaSqFt > 0) { doc.text(`Total: ${totalAreaSqFt.toFixed(2)} ${scaleUnit}\u00b2`, margin + 8, yPos); yPos += 7; }
        }
        yPos += 6;
      };

      // Iterate tabs in order: Plan 1 first, then named tabs
      const tabOrder = [defaultTabLabel, ...planTabsList.map(t => t.name)];
      for (const tabName of tabOrder) {
        if (!groupedByTab[tabName]) continue;
        // Tab section header
        if (yPos > 260) { doc.addPage(); yPos = 25; }
        doc.setFontSize(15);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(30, 80, 160);
        doc.text(tabName, margin, yPos);
        doc.setTextColor(0, 0, 0);
        yPos += 3;
        // Underline
        doc.setDrawColor(30, 80, 160);
        doc.setLineWidth(0.5);
        doc.line(margin, yPos, pageWidth - margin, yPos);
        doc.setDrawColor(0, 0, 0);
        yPos += 8;
        // Categories within this tab
        Object.entries(groupedByTab[tabName]).forEach(([categoryName, items]) => {
          renderCategoryBlock(categoryName, items);
        });
        yPos += 4;
      }

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
    const allMeasurementsForCSV = allMeasurements.length > 0 ? allMeasurements : (measurements ?? []);
    if (allMeasurementsForCSV.length === 0) {
      toast.error("No measurements to export");
      return;
    }

    // Build tab name lookup
    const defaultTabLabelCSV = project?.defaultTabName || 'Plan 1';
    const tabNameMapCSV: Record<string, string> = { 'null': defaultTabLabelCSV };
    planTabsList.forEach(t => { tabNameMapCSV[String(t.id)] = t.name; });

    const csvRows: string[] = [];

    // Helper to compute category totals for a set of measurements
    const buildCategoryTotals = (items: typeof allMeasurementsForCSV) => {
      const totals: Record<string, { type: string; total: number; unit: string; count: number }> = {};
      for (const m of items) {
        const isWall = WALL_CATEGORIES.includes(m.name);
        const isPoint = !isWall && (m.type === 'point' || (m.count !== null && m.count !== undefined && m.type !== 'line'));
        const isLine = !isWall && !isPoint && (m.perimeter === null || m.perimeter === undefined);
        if (!totals[m.name]) {
          if (isWall) totals[m.name] = { type: 'Wall', total: 0, unit: `${scaleUnit}\u00b2`, count: 0 };
          else if (isPoint) totals[m.name] = { type: 'Count', total: 0, unit: 'items', count: 0 };
          else if (isLine) totals[m.name] = { type: 'Linear', total: 0, unit: scaleUnit, count: 0 };
          else totals[m.name] = { type: 'Area', total: 0, unit: `${scaleUnit}\u00b2`, count: 0 };
        }
        const entry = totals[m.name];
        entry.count += 1;
        entry.total += isPoint ? 1 : (parseFloat(m.area ?? '0') || 0);
      }
      return totals;
    };

    const detailRow = (m: typeof allMeasurementsForCSV[0]) => {
      const isWall = WALL_CATEGORIES.includes(m.name);
      const isPoint = !isWall && (m.type === 'point' || (m.count !== null && m.count !== undefined && m.type !== 'line'));
      const isLine = !isWall && !isPoint && (m.perimeter === null || m.perimeter === undefined);
      if (isWall) {
        const height = m.count != null ? (m.count / 1000).toFixed(2) : '?';
        return `"${m.name}","Wall","${m.perimeter} linear x ${height} h = ${m.area}","${scaleUnit}\u00b2"`;
      } else if (isPoint) return `"${m.name}","Count","1","item"`;
      else if (isLine) return `"${m.name}","Linear","${m.area ?? '0'}","${scaleUnit}"`;
      else return `"${m.name}","Area","${m.area ?? '0'}","${scaleUnit}\u00b2"`;
    };

    // Group by tab
    const tabOrder = [defaultTabLabelCSV, ...planTabsList.map(t => t.name)];
    const groupedByTabCSV: Record<string, typeof allMeasurementsForCSV> = {};
    for (const m of allMeasurementsForCSV) {
      const tabKey = m.tabId === null || m.tabId === undefined ? 'null' : String(m.tabId);
      const tabName = tabNameMapCSV[tabKey] ?? `Plan ${tabKey}`;
      if (!groupedByTabCSV[tabName]) groupedByTabCSV[tabName] = [];
      groupedByTabCSV[tabName].push(m);
    }

    for (const tabName of tabOrder) {
      if (!groupedByTabCSV[tabName]) continue;
      const tabItems = groupedByTabCSV[tabName];
      csvRows.push(`"=== ${tabName} ==="`);
      csvRows.push('SUMMARY');
      csvRows.push('Category,Type,Total,Unit,# Measurements');
      const totals = buildCategoryTotals(tabItems);
      Object.entries(totals).forEach(([name, d]) => {
        csvRows.push(`"${name}","${d.type}","${d.total.toFixed(2)}","${d.unit}","${d.count}"`);
      });
      csvRows.push('');
      csvRows.push('DETAIL');
      csvRows.push('Category,Type,Value,Unit');
      tabItems.forEach(m => csvRows.push(detailRow(m)));
      csvRows.push('');
    }

    const csv = csvRows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project?.name || 'measurements'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('CSV exported — all plans included');
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

        {/* Toolbar — two rows on tablet/mobile, single scrollable row on desktop */}
        {/* Row 1: Primary tools + Zoom + Page nav */}
        <div className="px-2 md:px-4 py-1.5 flex items-center gap-1.5 overflow-x-auto scrollbar-none border-b border-border/50">
          {/* Primary Drawing Tools */}
          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant={isDrawing ? "default" : "outline"}
              size="sm"
              className="h-9 px-2.5 shrink-0 gap-1.5"
              onClick={() => {
                setIsDrawing(!isDrawing);
                setIsEditMode(false);
                setIsExactMode(false);
                setIsCountingMode(false);
                if (isDrawing) setCurrentPolygon([]);
              }}
              title="Draw polygon or line measurement"
            >
              <Pencil className="w-4 h-4" />
              <span className="hidden sm:inline text-xs">{isDrawing ? "Stop" : "Draw"}</span>
            </Button>
            <Button
              variant={isCountingMode ? "default" : "outline"}
              size="sm"
              className="h-9 px-2.5 shrink-0 gap-1.5"
              onClick={() => {
                if (isCountingMode) { setIsCountingMode(false); setIsDrawing(false); }
                else setShowCountCategoryDialog(true);
              }}
              title="Count items (point markers)"
            >
              <Hash className="w-4 h-4" />
              <span className="hidden sm:inline text-xs">{isCountingMode ? "Stop" : "Count"}</span>
            </Button>
            <Button
              variant={isEditMode ? "default" : "outline"}
              size="sm"
              className="h-9 px-2.5 shrink-0 gap-1.5"
              onClick={() => {
                setIsEditMode(!isEditMode);
                setIsDrawing(false); setIsCountingMode(false); setIsExactMode(false);
                setIsTextMode(false); setSelectedMeasurementId(null);
              }}
              title="Edit measurement vertices"
            >
              <MousePointer2 className="w-4 h-4" />
              <span className="hidden sm:inline text-xs">{isEditMode ? "Stop" : "Edit"}</span>
            </Button>
          </div>

          <Separator orientation="vertical" className="h-6 shrink-0" />

          {/* Annotation Tools */}
          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant={isTextMode ? "default" : "outline"}
              size="sm"
              className="h-9 px-2.5 shrink-0 gap-1.5"
              onClick={() => {
                const next = !isTextMode;
                setIsTextMode(next);
                if (next) { setIsDrawing(false); setIsEditMode(false); setIsCountingMode(false); setCurrentPolygon([]); }
              }}
              title="Add text box annotation"
            >
              <Type className="w-4 h-4" />
              <span className="hidden sm:inline text-xs">{isTextMode ? "Stop" : "Text"}</span>
            </Button>
            <Button
              variant={isRectMode ? "default" : "outline"}
              size="sm"
              className="h-9 px-2.5 shrink-0 gap-1.5"
              onClick={() => {
                const next = !isRectMode;
                setIsRectMode(next);
                if (next) {
                  setIsDrawing(false); setIsEditMode(false); setIsCountingMode(false);
                  setIsTextMode(false); setIsDimMode(false); setIsCalloutMode(false); setIsCutoutMode(false);
                  setCurrentPolygon([]); setRectFirstPoint(null);
                } else { setRectFirstPoint(null); }
              }}
              title="Rectangle area — click two opposite corners"
            >
              <Square className="w-4 h-4" />
              <span className="hidden sm:inline text-xs">{isRectMode ? "Stop" : "Rect"}</span>
            </Button>
            <Button
              variant={isDimMode ? "default" : "outline"}
              size="sm"
              className="h-9 px-2.5 shrink-0 gap-1.5"
              onClick={() => {
                const next = !isDimMode;
                setIsDimMode(next);
                if (next) {
                  setIsDrawing(false); setIsEditMode(false); setIsCountingMode(false);
                  setIsTextMode(false); setIsRectMode(false); setIsCalloutMode(false); setIsCutoutMode(false);
                  setCurrentPolygon([]); setDimStep(0); setDimPoint1(null); setDimPoint2(null);
                } else { setDimStep(0); setDimPoint1(null); setDimPoint2(null); }
              }}
              title="Dimension line — click 2 points, scroll to set offset"
            >
              <Ruler className="w-4 h-4" />
              <span className="hidden sm:inline text-xs">{isDimMode ? "Stop" : "Dim"}</span>
            </Button>
            <Button
              variant={isCalloutMode ? "default" : "outline"}
              size="sm"
              className="h-9 px-2.5 shrink-0 gap-1.5"
              onClick={() => {
                const next = !isCalloutMode;
                setIsCalloutMode(next);
                if (next) {
                  setIsDrawing(false); setIsEditMode(false); setIsCountingMode(false);
                  setIsTextMode(false); setIsRectMode(false); setIsDimMode(false); setIsCutoutMode(false);
                  setCurrentPolygon([]); setCalloutStep(0); setCalloutAnchor(null);
                } else { setCalloutStep(0); setCalloutAnchor(null); }
              }}
              title="Callout bubble — click anchor, then place label"
            >
              <MessageSquare className="w-4 h-4" />
              <span className="hidden sm:inline text-xs">{isCalloutMode ? "Stop" : "Note"}</span>
            </Button>
            <Button
              variant={isCutoutMode ? "default" : "outline"}
              size="sm"
              className="h-9 px-2.5 shrink-0 gap-1.5"
              onClick={() => {
                if (isCutoutMode) { setIsCutoutMode(false); setCutoutParentId(null); setIsDrawing(false); setCurrentPolygon([]); }
                else setShowCutoutPickerDialog(true);
              }}
              title="Cutout — subtract HVAC unit, skylight, penthouse from an area"
            >
              <Scissors className="w-4 h-4" />
              <span className="hidden sm:inline text-xs">{isCutoutMode ? "Stop" : "Cutout"}</span>
            </Button>
          </div>

          <Separator orientation="vertical" className="h-6 shrink-0" />

          {/* Zoom Controls */}
          <div className="flex items-center gap-1 shrink-0">
            <Button variant="outline" size="sm" className="h-9 w-9 p-0 shrink-0" onClick={handleZoomOut} disabled={zoomLevel <= 0.1} title="Zoom out">
              <ZoomOut className="w-4 h-4" />
            </Button>
            <span className="text-xs font-mono w-10 text-center shrink-0">{(zoomLevel * 100).toFixed(0)}%</span>
            <Button variant="outline" size="sm" className="h-9 w-9 p-0 shrink-0" onClick={handleZoomIn} disabled={zoomLevel >= 3.0} title="Zoom in">
              <ZoomIn className="w-4 h-4" />
            </Button>
            <Button variant="outline" size="sm" className="h-9 w-9 p-0 shrink-0" onClick={handleZoomReset} title="Reset zoom (100%)">
              <RotateCcw className="w-4 h-4" />
            </Button>
            <Button variant="outline" size="sm" className="h-9 w-9 p-0 shrink-0" onClick={() => handleFitToScreen()} title="Fit to screen (F)">
              <Maximize2 className="w-4 h-4" />
            </Button>
          </div>

          <Separator orientation="vertical" className="h-6 shrink-0" />

          {/* Calibrate */}
          <Button
            variant="outline"
            size="sm"
            className="h-9 px-2.5 shrink-0 gap-1.5"
            onClick={() => setShowCalibrationChooser(true)}
            title="Set drawing scale"
          >
            <SlidersHorizontal className="w-4 h-4" />
            <span className="hidden sm:inline text-xs">Calibrate</span>
          </Button>

          {/* Page Navigation (always visible, compact) */}
          {(pdfDoc?.numPages ?? 1) > 1 && (
            <>
              <Separator orientation="vertical" className="h-6 shrink-0" />
              <div className="flex items-center gap-1 shrink-0">
                <Button variant="outline" size="sm" className="h-9 w-9 p-0 shrink-0" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage <= 1}>
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <span className="text-xs font-mono w-12 text-center shrink-0">{currentPage}/{pdfDoc?.numPages ?? 1}</span>
                <Button variant="outline" size="sm" className="h-9 w-9 p-0 shrink-0" onClick={() => setCurrentPage(p => Math.min(pdfDoc?.numPages ?? 1, p + 1))} disabled={currentPage >= (pdfDoc?.numPages ?? 1)}>
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </>
          )}
        </div>

        {/* Row 2: Scale + Category + Color + Exact (only shown when drawing or scale is relevant) */}
        <div className="px-2 md:px-4 py-1.5 flex items-center gap-1.5 overflow-x-auto scrollbar-none">
          {/* Scale Settings — always visible */}
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-xs font-medium text-muted-foreground shrink-0">Scale:</span>
            <Input
              type="number"
              value={scale}
              onChange={(e) => setScale(parseFloat(e.target.value) || 1.0)}
              className="w-16 h-8 text-xs shrink-0"
              step="0.1"
            />
            <Select value={scaleUnit} onValueChange={(val) => {
              setScaleUnit(val);
              updateProjectMutation.mutate({ id: projectId, scaleUnit: val });
            }}>
              <SelectTrigger className="w-16 h-8 text-xs shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ft">ft</SelectItem>
                <SelectItem value="m">m</SelectItem>
              </SelectContent>
            </Select>
            <span className="hidden md:inline text-xs text-muted-foreground shrink-0">per inch</span>
          </div>

          {/* Text annotation controls — only when a text box is selected */}
          {selectedTextId !== null && !isDrawing && (() => {
            const selAnn = textAnnotationsList.find(a => a.id === selectedTextId);
            if (!selAnn) return null;
            return (
              <>
                <Separator orientation="vertical" className="h-6 shrink-0" />
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="hidden sm:inline text-xs font-medium text-muted-foreground shrink-0">Font:</span>
                  <Select
                    value={String(selAnn.fontSize)}
                    onValueChange={(val) => {
                      updateTextAnnotationMutation.mutate({ id: selAnn.id, projectId, fontSize: parseInt(val) });
                    }}
                  >
                    <SelectTrigger className="w-16 h-8 text-xs shrink-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48].map(sz => (
                        <SelectItem key={sz} value={String(sz)}>{sz}px</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <input
                    type="color"
                    value={selAnn.textColor}
                    onChange={(e) => updateTextAnnotationMutation.mutate({ id: selAnn.id, projectId, textColor: e.target.value })}
                    className="w-8 h-8 rounded border border-border cursor-pointer shrink-0"
                    title="Text color"
                  />
                  <input
                    type="color"
                    value={selAnn.bgColor === 'transparent' ? '#ffffff' : selAnn.bgColor}
                    onChange={(e) => updateTextAnnotationMutation.mutate({ id: selAnn.id, projectId, bgColor: e.target.value })}
                    className="w-8 h-8 rounded border border-border cursor-pointer shrink-0"
                    title="Background color"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 shrink-0 text-xs"
                    onClick={() => updateTextAnnotationMutation.mutate({ id: selAnn.id, projectId, bgColor: 'transparent' })}
                    title="Transparent background"
                  >
                    None
                  </Button>
                </div>
              </>
            );
          })()}

          {/* Category + Color + Exact — only when drawing */}
          {isDrawing && (
            <>
              <Separator orientation="vertical" className="h-6 shrink-0" />
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="hidden sm:inline text-xs font-medium text-muted-foreground shrink-0">Category:</span>
                <Select
                  value={isCustomCategory ? "__custom__" : selectedCategory}
                  onValueChange={(val) => {
                    if (val === "__custom__") {
                      setIsCustomCategory(true);
                      setMeasurementName("");
                    } else {
                      setIsCustomCategory(false);
                      setSelectedCategory(val);
                      setMeasurementName(val);
                      // Auto-switch mode based on category type
                      const customCat = customCategories?.find((c: { name: string }) => c.name === val);
                      if (customCat && customCat.measurementType) {
                        if (customCat.measurementType === 'count') {
                          setIsCountingMode(true); setIsDrawing(false);
                        } else {
                          setIsCountingMode(false); setIsDrawing(true);
                        }
                      }
                    }
                  }}
                >
                  <SelectTrigger className="w-32 h-8 text-xs shrink-0">
                    <SelectValue placeholder="Category" />
                  </SelectTrigger>
                  <SelectContent>
                    {PRESET_CATEGORIES.map((cat) => (
                      <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                    ))}
                    {customCategories && customCategories.length > 0 && (
                      <>
                        <div className="px-2 py-1 text-xs text-muted-foreground font-medium">Custom</div>
                        {customCategories.map((cat: { id: number; name: string }) => (
                          <SelectItem key={cat.id} value={cat.name}>{cat.name}</SelectItem>
                        ))}
                      </>
                    )}
                    <SelectItem value="__custom__">+ Other</SelectItem>
                  </SelectContent>
                </Select>
                {isCustomCategory && (
                  <Input
                    placeholder="Category name"
                    value={measurementName}
                    onChange={(e) => setMeasurementName(e.target.value)}
                    className="w-28 h-8 text-xs shrink-0"
                  />
                )}
              </div>

              <Separator orientation="vertical" className="h-6 shrink-0" />

              {/* Color Selector */}
              <div className="flex items-center gap-1 shrink-0">
                <span className="hidden sm:inline text-xs font-medium text-muted-foreground shrink-0">Color:</span>
                <div className="flex gap-1 shrink-0">
                  {["#ef4444","#f97316","#eab308","#22c55e","#3b82f6","#8b5cf6","#ec4899","#14b8a6"].map((color) => (
                    <button
                      key={color}
                      className={`w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 shrink-0 ${selectedColor === color ? "border-foreground scale-110" : "border-transparent"}`}
                      style={{ backgroundColor: color }}
                      onClick={() => setSelectedColor(color)}
                      title={color}
                    />
                  ))}
                </div>
              </div>

              <Separator orientation="vertical" className="h-6 shrink-0" />

              {/* Exact Mode */}
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="hidden sm:inline text-xs font-medium text-muted-foreground shrink-0">Exact:</span>
                <Button
                  variant={isExactMode ? "default" : "outline"}
                  size="sm"
                  className="h-8 px-2 text-xs shrink-0"
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
                    className="w-20 h-8 text-xs shrink-0"
                  />
                )}
              </div>
            </>
          )}
        </div>
      </header>


      {/* Plan Tab Bar */}
      <div className="flex items-center gap-0 border-b border-border bg-muted/40 px-2 overflow-x-auto shrink-0" style={{ minHeight: '38px' }}>
        {/* Default tab: original project plan — double-click to rename */}
        <div className="relative group flex items-center">
          {renamingDefaultTab ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const trimmed = renameDefaultTabValue.trim();
                if (trimmed) {
                  updateProjectMutation.mutate(
                    { id: projectId, defaultTabName: trimmed },
                    { onSuccess: () => { setRenamingDefaultTab(false); toast.success("Plan renamed"); } }
                  );
                } else {
                  setRenamingDefaultTab(false);
                }
              }}
              className="flex items-center gap-1 px-2"
            >
              <input
                autoFocus
                value={renameDefaultTabValue}
                onChange={(e) => setRenameDefaultTabValue(e.target.value)}
                onBlur={() => {
                  const trimmed = renameDefaultTabValue.trim();
                  if (trimmed) {
                    updateProjectMutation.mutate(
                      { id: projectId, defaultTabName: trimmed },
                      { onSuccess: () => { setRenamingDefaultTab(false); } }
                    );
                  } else {
                    setRenamingDefaultTab(false);
                  }
                }}
                onKeyDown={(e) => { if (e.key === 'Escape') setRenamingDefaultTab(false); }}
                className="w-28 h-6 text-sm px-1 border border-border rounded bg-background"
              />
            </form>
          ) : (
            <button
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-t border-b-2 transition-colors whitespace-nowrap ${
                activeTabId === null
                  ? 'border-primary text-primary bg-background'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
              onClick={() => setActiveTabId(null)}
              onDoubleClick={() => {
                setRenamingDefaultTab(true);
                setRenameDefaultTabValue(project?.defaultTabName || 'Plan 1');
              }}
              title="Double-click to rename"
            >
              <FileText className="w-3.5 h-3.5" />
              <span className="max-w-[100px] truncate">{project?.defaultTabName || 'Plan 1'}</span>
            </button>
          )}
        </div>

        {/* Additional plan tabs */}
        {planTabsList.map((tab) => (
          <div key={tab.id} className="relative group flex items-center">
            {renamingTabId === tab.id ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (renameTabValue.trim()) {
                    renamePlanTabMutation.mutate({ id: tab.id, name: renameTabValue.trim() });
                  } else {
                    setRenamingTabId(null);
                  }
                }}
                className="flex items-center gap-1 px-2"
              >
                <input
                  autoFocus
                  value={renameTabValue}
                  onChange={(e) => setRenameTabValue(e.target.value)}
                  onBlur={() => {
                    if (renameTabValue.trim()) {
                      renamePlanTabMutation.mutate({ id: tab.id, name: renameTabValue.trim() });
                    } else {
                      setRenamingTabId(null);
                    }
                  }}
                  onKeyDown={(e) => { if (e.key === 'Escape') setRenamingTabId(null); }}
                  className="w-28 h-6 text-sm px-1 border border-border rounded bg-background"
                />
              </form>
            ) : (
              <button
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-t border-b-2 transition-colors whitespace-nowrap ${
                  activeTabId === tab.id
                    ? 'border-primary text-primary bg-background'
                    : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted'
                }`}
                onClick={() => setActiveTabId(tab.id)}
                onDoubleClick={() => { setRenamingTabId(tab.id); setRenameTabValue(tab.name); }}
                title="Double-click to rename"
              >
                <FileText className="w-3.5 h-3.5" />
                <span className="max-w-[100px] truncate">{tab.name}</span>
                <span
                  role="button"
                  tabIndex={0}
                  className="ml-0.5 opacity-0 group-hover:opacity-100 transition-opacity rounded hover:bg-destructive/20 hover:text-destructive p-0.5"
                  onClick={(e) => { e.stopPropagation(); setDeleteTabConfirmId(tab.id); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); setDeleteTabConfirmId(tab.id); } }}
                  title="Delete tab"
                >
                  <X className="w-3 h-3" />
                </span>
              </button>
            )}
          </div>
        ))}

        {/* Add tab button */}
        <button
          className="flex items-center gap-1 px-2 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors ml-1 whitespace-nowrap"
          onClick={() => setAddTabDialogOpen(true)}
          title="Add plan tab"
        >
          <Plus className="w-3.5 h-3.5" />
          <span className="hidden sm:inline text-xs">Add Plan</span>
        </button>
      </div>

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
            {/* Inline editor for a callout bubble. It shares the canvas transform so typing stays aligned while panned or zoomed. */}
            {editingCalloutId !== null && (() => {
              const callout = renderedCallouts.find(item => item.id === editingCalloutId);
              if (!callout) return null;
              return <div style={{ position: 'absolute', left: callout.bubbleX * zoomLevel, top: callout.bubbleY * zoomLevel, width: callout.bubbleW * zoomLevel, height: callout.bubbleH * zoomLevel, zIndex: 101 }}>
                <textarea
                  autoFocus
                  aria-label="Edit callout label"
                  value={editingCalloutText}
                  onChange={event => setEditingCalloutText(event.target.value)}
                  onBlur={() => {
                    if (editingCalloutId !== null) updateCalloutMutation.mutate({ id: editingCalloutId, projectId, text: editingCalloutText });
                    setEditingCalloutId(null);
                  }}
                  onKeyDown={event => {
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      setEditingCalloutId(null);
                    }
                    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') event.currentTarget.blur();
                  }}
                  style={{ width: '100%', height: '100%', resize: 'none', border: '2px solid #3b82f6', borderRadius: 8, padding: Math.max(6, 8 * zoomLevel), fontSize: Math.max(10, 11 * zoomLevel), fontFamily: 'sans-serif', background: callout.color, color: callout.textColor, outline: 'none', boxSizing: 'border-box' }}
                />
              </div>;
            })()}
            {selectedCalloutId !== null && editingCalloutId === null && (() => {
              const callout = renderedCallouts.find(item => item.id === selectedCalloutId);
              if (!callout) return null;
              return <button
                type="button"
                aria-label="Delete selected label"
                title="Delete label"
                onPointerDown={event => event.stopPropagation()}
                onClick={event => {
                  event.stopPropagation();
                  if (confirm('Delete this label?')) {
                    deleteCalloutMutation.mutate({ id: callout.id, projectId });
                    toast.success('Label deleted');
                  }
                }}
                style={{ position: 'absolute', left: callout.bubbleX * zoomLevel + callout.bubbleW * zoomLevel - 22, top: callout.bubbleY * zoomLevel - 22, zIndex: 102, width: 44, height: 44, borderRadius: 9999, border: '2px solid #ffffff', background: '#dc2626', color: '#ffffff', fontSize: 24, fontWeight: 700, lineHeight: 1, boxShadow: '0 2px 8px rgba(0,0,0,0.25)', cursor: 'pointer', touchAction: 'manipulation' }}
              >
                ×
              </button>;
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
                const canvas = overlayCanvasRef.current;
                if (!canvas) return;
                const rect = canvas.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;

                // Callout label drag — geometry is kept locally during the gesture for smooth 60fps feedback.
                if (draggingCalloutId !== null && draggingCalloutPart && calloutDragStart) {
                  const dx = (x - calloutDragStart.mouseX) / zoomLevel;
                  const dy = (y - calloutDragStart.mouseY) / zoomLevel;
                  updateCalloutDraft(
                    draggingCalloutId,
                    draggingCalloutPart === 'bubble'
                      ? { bubbleX: calloutDragStart.origX + dx, bubbleY: calloutDragStart.origY + dy }
                      : { anchorX: calloutDragStart.origX + dx, anchorY: calloutDragStart.origY + dy },
                  );
                  return;
                }

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
                const canvasX = e.clientX - rect.left;
                const canvasY = e.clientY - rect.top;
                const calloutHit = getCalloutHit(canvasX, canvasY);
                if (calloutHit) {
                  setSelectedCalloutId(calloutHit.callout.id);
                  setEditingCalloutId(calloutHit.callout.id);
                  setEditingCalloutText(calloutHit.callout.text);
                  return;
                }
                const x = canvasX / zoomLevel;
                const y = canvasY / zoomLevel;
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
                cursor: isPanning ? "grabbing" : (isDrawing ? "none" : (isTextMode || selectedTextId !== null ? "default" : "grab")),
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
                                  <div key={measurement.id} className="contents">
                                  <div
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
                                              {(() => {
                                                const myCuts = cutoutsList.filter((c: Cutout) => c.parentMeasurementId === measurement.id);
                                                if (myCuts.length === 0) return null;
                                                const cutTotal = myCuts.reduce((s: number, c: Cutout) => s + parseFloat(String(c.area)), 0);
                                                const net = Math.max(0, parseFloat(String(measurement.area)) - cutTotal);
                                                return (
                                                  <div className="text-[10px] font-medium text-orange-500 mt-0.5">
                                                    −{cutTotal.toFixed(1)} {scaleUnit}² cutouts → Net: {net.toFixed(1)} {scaleUnit}²
                                                  </div>
                                                );
                                              })()}
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
                                      {measurement.type === 'area' && (
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          className="h-7 w-7 p-0"
                                          title="Add cutout — subtract HVAC unit, skylight, etc."
                                          onClick={() => {
                                            setCutoutParentId(measurement.id);
                                            setIsCutoutMode(true);
                                            setIsDrawing(true);
                                            setIsEditMode(false);
                                            setIsCountingMode(false);
                                            setIsTextMode(false);
                                            setIsRectMode(false);
                                            setIsDimMode(false);
                                            setIsCalloutMode(false);
                                            setCurrentPolygon([]);
                                            toast("Draw the cutout polygon, then press Escape to save", { duration: 4000 });
                                          }}
                                        >
                                          <Scissors className="w-3.5 h-3.5 text-orange-500" />
                                        </Button>
                                      )}
                                    </div>
                                  </div>
                                  {/* Cutout sub-rows — shown for area measurements that have cutouts */}
                                  {measurement.type === 'area' && (() => {
                                    const myCuts = cutoutsList.filter((c: Cutout) => c.parentMeasurementId === measurement.id);
                                    if (myCuts.length === 0) return null;
                                    return (
                                      <div className="border-t border-dashed border-border/60 bg-muted/30">
                                        {myCuts.map((cutout: Cutout) => (
                                          <div
                                            key={cutout.id}
                                            className="flex items-center justify-between px-3 py-1.5 hover:bg-accent/40 transition-colors"
                                          >
                                            <div className="flex items-center gap-2 flex-1 min-w-0">
                                              <div className="w-3 h-3 shrink-0 flex items-center justify-center">
                                                <div className="w-2 h-2 rounded-sm border-2 border-red-400 bg-transparent" />
                                              </div>
                                              <div className="flex-1 min-w-0">
                                                <p className="text-xs font-medium text-foreground truncate">{cutout.name}</p>
                                                <p className="text-[10px] text-red-500">−{parseFloat(String(cutout.area)).toFixed(1)} {scaleUnit}²</p>
                                              </div>
                                            </div>
                                            <Button
                                              variant="ghost"
                                              size="sm"
                                              className="h-6 w-6 p-0 shrink-0"
                                              title="Delete this cutout"
                                              onClick={() => {
                                                if (confirm(`Delete cutout "${cutout.name}"?`)) {
                                                  deleteCutoutMutation.mutate({ id: cutout.id, projectId });
                                                }
                                              }}
                                            >
                                              <Trash2 className="w-3 h-3 text-destructive" />
                                            </Button>
                                          </div>
                                        ))}
                                      </div>
                                    );
                                  })()}
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

      {/* ── Calibration Chooser Dialog ─────────────────────────────────────────── */}
      <Dialog open={showCalibrationChooser} onOpenChange={(open) => {
        setShowCalibrationChooser(open);
        if (!open) {
          setScaleNotationInput("");
          setScaleNotationError(null);
        }
      }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Calibrate Scale</DialogTitle>
            <DialogDescription>
              Choose how to set the drawing scale for accurate measurements
            </DialogDescription>
          </DialogHeader>

          <Tabs defaultValue="notation">
            <TabsList className="w-full">
              <TabsTrigger value="notation" className="flex-1">Scale Notation</TabsTrigger>
              <TabsTrigger value="drawline" className="flex-1">Draw a Line</TabsTrigger>
            </TabsList>

            {/* ── Tab 1: Scale Notation ── */}
            <TabsContent value="notation" className="space-y-4 pt-2">
              <p className="text-sm text-muted-foreground">
                Type the scale shown on your drawing, e.g. <strong>1/8&quot; = 1&apos;-0&quot;</strong>.
                The tool will compute the correct pixels-per-foot ratio automatically.
              </p>

              {/* Preset quick-select */}
              <div className="space-y-2">
                <Label>Common Architectural Scales</Label>
                <div className="grid grid-cols-2 gap-2">
                  {(() => {
                    // Correction factor: same as parseArchitecturalScale
                    // 96 / (baseScale × PDF_DPI) = 96 / (2.5 × 72) = 96/180
                    const cf = 96 / (2.5 * 72);
                    return [
                      { label: '1/16" = 1\'-0"', scale: 16 * cf },
                      { label: '3/32" = 1\'-0"', scale: (128/9) * cf },
                      { label: '1/8" = 1\'-0"',  scale: 8 * cf },
                      { label: '3/16" = 1\'-0"', scale: (64/9) * cf },
                      { label: '1/4" = 1\'-0"',  scale: 4 * cf },
                      { label: '3/8" = 1\'-0"',  scale: (8/3) * cf },
                      { label: '1/2" = 1\'-0"',  scale: 2 * cf },
                      { label: '3/4" = 1\'-0"',  scale: (4/3) * cf },
                      { label: '1" = 1\'-0"',    scale: 1 * cf },
                      { label: '1-1/2" = 1\'-0"',scale: (2/3) * cf },
                    ];
                  })().map(({ label, scale: presetScale }) => (
                    <Button
                      key={label}
                      variant="outline"
                      size="sm"
                      className="justify-start font-mono text-xs h-8"
                      onClick={() => {
                        const newScale = presetScale;
                        setScale(newScale);
                        if (activeTabId !== null) {
                          updatePlanTabStateMutation.mutate({ id: activeTabId, scale: newScale.toString(), scaleUnit });
                        } else {
                          updateProjectMutation.mutate({ id: projectId, scale: newScale.toString(), scaleUnit });
                        }
                        toast.success(`Scale set: ${label} → 1" = ${newScale.toFixed(3)} ${scaleUnit}`);
                        setShowCalibrationChooser(false);
                        setScaleNotationInput("");
                        setScaleNotationError(null);
                      }}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Free-form input */}
              <div className="space-y-2">
                <Label htmlFor="scale-notation-input">Or type a custom scale</Label>
                <Input
                  id="scale-notation-input"
                  value={scaleNotationInput}
                  onChange={(e) => {
                    setScaleNotationInput(e.target.value);
                    setScaleNotationError(null);
                  }}
                  placeholder={`e.g. 1/8" = 1'-0" or 1/4"=1'`}
                  className="font-mono"
                />
                {scaleNotationError && (
                  <p className="text-xs text-destructive">{scaleNotationError}</p>
                )}
                {(() => {
                  const parsed = parseArchitecturalScale(scaleNotationInput);
                  if (parsed !== null && scaleNotationInput.trim()) {
                    // Convert back to human-readable "1 paper inch = X ft" for display
                    const cf = 96 / (2.5 * 72);
                    const paperInchFt = parsed / cf;
                    return (
                      <p className="text-xs text-green-600 dark:text-green-400">
                        ✓ 1 paper inch = <strong>{paperInchFt.toFixed(3)}</strong> {scaleUnit} (scale applied)
                      </p>
                    );
                  }
                  return null;
                })()}
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => {
                  setShowCalibrationChooser(false);
                  setScaleNotationInput("");
                  setScaleNotationError(null);
                }}>Cancel</Button>
                <Button
                  onClick={() => {
                    const parsed = parseArchitecturalScale(scaleNotationInput);
                    if (parsed === null) {
                      setScaleNotationError(
                        'Could not parse. Try formats like: 1/8" = 1\'-0" or 1/4"=1\' or 0.125"=1\''
                      );
                      return;
                    }
                    setScale(parsed);
                    if (activeTabId !== null) {
                      updatePlanTabStateMutation.mutate({ id: activeTabId, scale: parsed.toString(), scaleUnit });
                    } else {
                      updateProjectMutation.mutate({ id: projectId, scale: parsed.toString(), scaleUnit });
                    }
                    toast.success(`Scale set: 1" = ${parsed.toFixed(3)} ${scaleUnit}`);
                    setShowCalibrationChooser(false);
                    setScaleNotationInput("");
                    setScaleNotationError(null);
                  }}
                  disabled={!scaleNotationInput.trim()}
                >
                  Apply Scale
                </Button>
              </DialogFooter>
            </TabsContent>

            {/* ── Tab 2: Draw a Line ── */}
            <TabsContent value="drawline" className="space-y-4 pt-2">
              <p className="text-sm text-muted-foreground">
                Click two points on a known dimension line on the drawing, then enter the real-world distance.
              </p>
              <div className="rounded-md bg-muted p-3 text-sm">
                <strong>How to use:</strong>
                <ol className="list-decimal list-inside mt-1 space-y-1 text-muted-foreground text-xs">
                  <li>Click <strong>Start Drawing Line</strong> below to enter calibration mode</li>
                  <li>Click the start of a known dimension on the plan</li>
                  <li>Click the end of that dimension</li>
                  <li>Enter the real-world length in the dialog that appears</li>
                </ol>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowCalibrationChooser(false)}>Cancel</Button>
                <Button onClick={() => {
                  setShowCalibrationChooser(false);
                  setIsCalibrating(true);
                }}>
                  Start Drawing Line
                </Button>
              </DialogFooter>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* ── Calibration Distance Dialog (after drawing two points) ─────────────── */}
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
                  
                  // Save to database (tab-aware)
                  if (activeTabId !== null) {
                    updatePlanTabStateMutation.mutate({ id: activeTabId, scale: newScale.toString(), scaleUnit });
                  } else {
                    updateProjectMutation.mutate({ id: projectId, scale: newScale.toString(), scaleUnit });
                  }
                  
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

      {/* ── Add Plan Tab Dialog ─────────────────────────────────────────────────── */}
      <Dialog open={addTabDialogOpen} onOpenChange={(open) => {
        setAddTabDialogOpen(open);
        if (!open) { setNewTabName(""); setNewTabFile(null); }
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Plan Tab</DialogTitle>
            <DialogDescription>Upload a PDF for this plan and give it a name.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-tab-name">Plan Name</Label>
              <Input
                id="new-tab-name"
                value={newTabName}
                onChange={(e) => setNewTabName(e.target.value)}
                placeholder="e.g. Roof Plan, Floor 2, Elevation A"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-tab-pdf">PDF File</Label>
              <Input
                id="new-tab-pdf"
                type="file"
                accept=".pdf"
                onChange={(e) => setNewTabFile(e.target.files?.[0] ?? null)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddTabDialogOpen(false)}>Cancel</Button>
            <Button
              disabled={!newTabName.trim() || !newTabFile || addTabLoading}
              onClick={async () => {
                if (!newTabFile || !newTabName.trim()) return;
                setAddTabLoading(true);
                try {
                  // Convert File to base64 for tRPC upload
                  const arrayBuffer = await newTabFile.arrayBuffer();
                  const base64 = btoa(
                    new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
                  );
                  createPlanTabMutation.mutate({
                    projectId,
                    name: newTabName.trim(),
                    pdfFile: {
                      data: base64,
                      filename: newTabFile.name,
                      mimeType: newTabFile.type || 'application/pdf',
                    },
                  });
                } catch (err) {
                  toast.error('Failed to upload PDF');
                  setAddTabLoading(false);
                }
              }}
            >
              {addTabLoading ? 'Uploading...' : 'Add Plan'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Plan Tab Confirmation ────────────────────────────────────────── */}
      <Dialog open={deleteTabConfirmId !== null} onOpenChange={(open) => { if (!open) setDeleteTabConfirmId(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Plan Tab?</DialogTitle>
            <DialogDescription>
              This will permanently delete the plan tab and all its measurements. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTabConfirmId(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleteTabConfirmId !== null) {
                  deletePlanTabMutation.mutate({ id: deleteTabConfirmId });
                }
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* ─── Cutout Parent Picker Dialog ─────────────────────────────────────── */}
      <Dialog open={showCutoutPickerDialog} onOpenChange={setShowCutoutPickerDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Select Area to Cut From</DialogTitle>
            <DialogDescription>
              Choose which area measurement you want to subtract from. Then draw the cutout polygon on the canvas.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2 space-y-2 max-h-64 overflow-y-auto">
            {( measurements ?? []).filter(m => m.type === 'area').length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No area measurements found. Draw an area first.</p>
            ) : (
              ( measurements ?? []).filter(m => m.type === 'area').map(m => (
                <button
                  key={m.id}
                  className="w-full flex items-center gap-3 p-3 rounded-lg border hover:bg-accent transition-colors text-left"
                  onClick={() => {
                    setCutoutParentId(m.id);
                    setIsCutoutMode(true);
                    setIsDrawing(true);
                    setIsEditMode(false);
                    setIsCountingMode(false);
                    setIsTextMode(false);
                    setIsRectMode(false);
                    setIsDimMode(false);
                    setIsCalloutMode(false);
                    setCurrentPolygon([]);
                    setShowCutoutPickerDialog(false);
                    toast(`Drawing cutout for "${m.name}" — draw polygon, then press Escape to save`, { duration: 5000 });
                  }}
                >
                  <div className="w-4 h-4 rounded flex-shrink-0" style={{ backgroundColor: m.color }} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{m.name}</div>
                    <div className="text-xs text-muted-foreground">{m.area} {scaleUnit}²</div>
                  </div>
                  <Scissors className="w-4 h-4 text-orange-500 flex-shrink-0" />
                </button>
              ))
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCutoutPickerDialog(false)}>Cancel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
