import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { ArrowLeft, Loader2, Plus, Trash2, Edit2, Save, Download, ZoomIn, ZoomOut, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocation, useParams } from "wouter";
import { toast } from "sonner";
import * as pdfjsLib from "pdfjs-dist";

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

export default function MeasurementCanvas() {
  const { id } = useParams<{ id: string }>();
  const projectId = parseInt(id || "0");
  const { user, loading: authLoading } = useAuth();
  const [, setLocation] = useLocation();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale] = useState(1.0);
  const [scaleUnit, setScaleUnit] = useState("ft");
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentPolygon, setCurrentPolygon] = useState<Point[]>([]);
  const [selectedColor, setSelectedColor] = useState(PRESET_COLORS[0]);
  const [measurementName, setMeasurementName] = useState("");
  const [isNameDialogOpen, setIsNameDialogOpen] = useState(false);
  const [editingProjectName, setEditingProjectName] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [notes, setNotes] = useState("");
  const [cursorPosition, setCursorPosition] = useState<Point | null>(null);
  const [zoomLevel, setZoomLevel] = useState(1.0);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState<Point | null>(null);

  const utils = trpc.useUtils();
  const { data: project, isLoading: projectLoading } = trpc.projects.get.useQuery({ id: projectId });
  const { data: measurements, isLoading: measurementsLoading } = trpc.measurements.list.useQuery({ projectId });

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
      redrawOverlay();
    },
  });

  const deleteMeasurementMutation = trpc.measurements.delete.useMutation({
    onSuccess: () => {
      utils.measurements.list.invalidate({ projectId });
      toast.success("Measurement deleted");
      redrawOverlay();
    },
  });

  // Load PDF
  useEffect(() => {
    if (!project?.pdfUrl) return;

    const loadPdf = async () => {
      try {
        console.log("Loading PDF from URL:", project.pdfUrl);
        const loadingTask = pdfjsLib.getDocument({
          url: project.pdfUrl,
          withCredentials: false,
          isEvalSupported: false,
        });
        const pdf = await loadingTask.promise;
        console.log("PDF loaded successfully, pages:", pdf.numPages);
        setPdfDoc(pdf);
        setScale(parseFloat(project.scale || "1.0"));
        setScaleUnit(project.scaleUnit || "ft");
        setNotes(project.notes || "");
        setNewProjectName(project.name);
      } catch (error) {
        console.error("Error loading PDF:", error);
        toast.error(`Failed to load PDF: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    };

    loadPdf();
  }, [project]);

  // Render PDF page with high quality
  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return;

    const renderPage = async () => {
      const page = await pdfDoc.getPage(currentPage);
      const canvas = canvasRef.current!;
      const context = canvas.getContext("2d")!;

      // High quality rendering: base scale 2.5 for crisp text, multiplied by zoom level
      const baseScale = 2.5;
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

  // Calculate distance between two points in pixels, then convert to feet
  const calculateDistance = (p1: Point, p2: Point): number => {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const pixelDistance = Math.sqrt(dx * dx + dy * dy);
    return pixelDistance * scale;
  };

  // Redraw overlay with measurements
  const redrawOverlay = () => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw saved measurements
    measurements?.forEach((measurement) => {
      const coords = measurement.coordinates as Point[];
      if (coords.length < 3) return;

      ctx.fillStyle = measurement.color + "40";
      ctx.strokeStyle = measurement.color;
      ctx.lineWidth = 2;

      ctx.beginPath();
      ctx.moveTo(coords[0].x, coords[0].y);
      coords.forEach((point) => ctx.lineTo(point.x, point.y));
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Draw label with area
      const centerX = coords.reduce((sum, p) => sum + p.x, 0) / coords.length;
      const centerY = coords.reduce((sum, p) => sum + p.y, 0) / coords.length;
      ctx.fillStyle = "#000";
      ctx.fillRect(centerX - 60, centerY - 25, 120, 40);
      ctx.fillStyle = "#fff";
      ctx.font = "bold 12px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(measurement.name, centerX, centerY - 8);
      ctx.font = "11px sans-serif";
      ctx.fillText(`${measurement.area} ${scaleUnit}²`, centerX, centerY + 8);
    });

    // Draw current polygon with AutoCAD-style lines and measurements
    if (currentPolygon.length > 0) {
      // Draw lines between points
      ctx.strokeStyle = selectedColor;
      ctx.lineWidth = 2;
      ctx.setLineDash([]);

      for (let i = 0; i < currentPolygon.length; i++) {
        const p1 = currentPolygon[i];
        const p2 = currentPolygon[(i + 1) % currentPolygon.length];
        
        if (i < currentPolygon.length - 1 || currentPolygon.length >= 3) {
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.stroke();

          // Draw distance label on each line
          if (i < currentPolygon.length - 1) {
            const distance = calculateDistance(p1, p2);
            const midX = (p1.x + p2.x) / 2;
            const midY = (p1.y + p2.y) / 2;
            
            ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
            ctx.fillRect(midX - 30, midY - 12, 60, 20);
            ctx.fillStyle = "#fff";
            ctx.font = "11px sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(`${distance.toFixed(1)} ${scaleUnit}`, midX, midY);
          }
        }
      }

      // Draw preview line from last point to cursor
      if (cursorPosition && currentPolygon.length > 0) {
        const lastPoint = currentPolygon[currentPolygon.length - 1];
        ctx.strokeStyle = selectedColor;
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(lastPoint.x, lastPoint.y);
        ctx.lineTo(cursorPosition.x, cursorPosition.y);
        ctx.stroke();
        ctx.setLineDash([]);

        // Show distance for preview line
        const distance = calculateDistance(lastPoint, cursorPosition);
        const midX = (lastPoint.x + cursorPosition.x) / 2;
        const midY = (lastPoint.y + cursorPosition.y) / 2;
        ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
        ctx.fillRect(midX - 30, midY - 12, 60, 20);
        ctx.fillStyle = "#fff";
        ctx.font = "11px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(`${distance.toFixed(1)} ${scaleUnit}`, midX, midY);
      }

      // Draw points
      currentPolygon.forEach((point, index) => {
        ctx.beginPath();
        ctx.arc(point.x, point.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = "#fff";
        ctx.fill();
        ctx.strokeStyle = selectedColor;
        ctx.lineWidth = 2;
        ctx.stroke();
      });

      // Show area preview if shape can be closed
      if (currentPolygon.length >= 3) {
        const area = calculateArea(currentPolygon);
        const centerX = currentPolygon.reduce((sum, p) => sum + p.x, 0) / currentPolygon.length;
        const centerY = currentPolygon.reduce((sum, p) => sum + p.y, 0) / currentPolygon.length;
        
        ctx.fillStyle = "rgba(0, 0, 0, 0.9)";
        ctx.fillRect(centerX - 50, centerY - 15, 100, 30);
        ctx.fillStyle = "#4ade80";
        ctx.font = "bold 12px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(`Area: ${area.toFixed(1)} ${scaleUnit}²`, centerX, centerY);
      }
    }

    // Draw crosshair cursor
    if (isDrawing && cursorPosition) {
      ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
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
      
      // Center circle
      ctx.beginPath();
      ctx.arc(cursorPosition.x, cursorPosition.y, 8, 0, Math.PI * 2);
      ctx.stroke();
    }
  };

  useEffect(() => {
    redrawOverlay();
  }, [measurements, currentPolygon, selectedColor, cursorPosition, scale, scaleUnit]);

  // Zoom controls
  const handleZoomIn = () => {
    setZoomLevel(prev => Math.min(prev + 0.25, 4.0));
  };

  const handleZoomOut = () => {
    setZoomLevel(prev => Math.max(prev - 0.25, 0.5));
  };

  const handleZoomReset = () => {
    setZoomLevel(1.0);
    setPanOffset({ x: 0, y: 0 });
  };

  // Handle mouse wheel zoom
  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setZoomLevel(prev => Math.max(0.5, Math.min(4.0, prev + delta)));
  };

  // Handle canvas click
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;

    const canvas = overlayCanvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    setCurrentPolygon([...currentPolygon, { x, y }]);
  };

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
    return Math.abs(area / 2) * scale * scale;
  };

  // Save measurement
  const saveMeasurement = () => {
    if (!measurementName.trim()) {
      toast.error("Please enter a name for this measurement");
      return;
    }

    const area = calculateArea(currentPolygon);
    createMeasurementMutation.mutate({
      projectId,
      name: measurementName,
      color: selectedColor,
      area: area.toFixed(2),
      coordinates: currentPolygon,
    });
    setIsNameDialogOpen(false);
  };

  // Export measurements
  const exportMeasurements = () => {
    if (!measurements || measurements.length === 0) {
      toast.error("No measurements to export");
      return;
    }

    const data = measurements.map((m) => ({
      name: m.name,
      area: `${m.area} ${scaleUnit}²`,
      color: m.color,
    }));

    const csv = [
      "Name,Area,Color",
      ...data.map((row) => `"${row.name}","${row.area}","${row.color}"`),
    ].join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${project?.name || "measurements"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Measurements exported");
  };

  if (authLoading || projectLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user || !project) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
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
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b border-border bg-card px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => setLocation("/projects")}>
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
            <Separator orientation="vertical" className="h-6" />
            {editingProjectName ? (
              <div className="flex items-center gap-2">
                <Input
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  className="w-64"
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
                <h1 className="text-xl font-semibold text-foreground">{project.name}</h1>
                <Button variant="ghost" size="sm" onClick={() => setEditingProjectName(true)}>
                  <Edit2 className="w-4 h-4" />
                </Button>
              </div>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={exportMeasurements} className="gap-2">
            <Download className="w-4 h-4" />
            Export
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Canvas Area */}
        <div className="flex-1 overflow-auto p-6" ref={containerRef}>
          <div className="relative inline-block">
            <canvas ref={canvasRef} className="border border-border rounded-lg shadow-lg" />
            <canvas
              ref={overlayCanvasRef}
              onClick={handleCanvasClick}
              onWheel={handleWheel}
              onMouseMove={(e) => {
                if (!isDrawing) return;
                const canvas = overlayCanvasRef.current!;
                const rect = canvas.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                setCursorPosition({ x, y });
              }}
              onMouseLeave={() => setCursorPosition(null)}
              className="absolute top-0 left-0"
              style={{ 
                pointerEvents: "auto",
                cursor: isDrawing ? "none" : "default"
              }}
            />
          </div>
        </div>

        {/* Sidebar */}
        <div className="w-80 border-l border-border bg-card overflow-y-auto">
          <div className="p-6 space-y-6">
            {/* Drawing Tools */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Drawing Tools</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-2">
                  <Button
                    variant={isDrawing ? "default" : "outline"}
                    onClick={() => {
                      setIsDrawing(!isDrawing);
                      if (isDrawing) setCurrentPolygon([]);
                    }}
                    className="flex-1"
                  >
                    {isDrawing ? "Stop Drawing" : "Start Drawing"}
                  </Button>
                  {isDrawing && currentPolygon.length >= 3 && (
                    <Button onClick={completePolygon} className="gap-2">
                      <Plus className="w-4 h-4" />
                      Complete
                    </Button>
                  )}
                </div>

                <div className="space-y-2">
                  <Label>Color</Label>
                  <div className="grid grid-cols-5 gap-2">
                    {PRESET_COLORS.map((color) => (
                      <button
                        key={color}
                        onClick={() => setSelectedColor(color)}
                        className={`w-10 h-10 rounded-md border-2 transition-all ${
                          selectedColor === color ? "border-foreground scale-110" : "border-border"
                        }`}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Zoom Controls */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Zoom Controls</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleZoomOut}
                    disabled={zoomLevel <= 0.5}
                    className="flex-1 gap-1"
                  >
                    <ZoomOut className="w-4 h-4" />
                    Out
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleZoomReset}
                    className="flex-1 gap-1"
                  >
                    <RotateCcw className="w-4 h-4" />
                    Reset
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleZoomIn}
                    disabled={zoomLevel >= 4.0}
                    className="flex-1 gap-1"
                  >
                    <ZoomIn className="w-4 h-4" />
                    In
                  </Button>
                </div>
                <div className="text-center text-sm text-muted-foreground">
                  Zoom: {(zoomLevel * 100).toFixed(0)}%
                </div>
                <p className="text-xs text-muted-foreground">
                  Use mouse wheel to zoom in/out
                </p>
              </CardContent>
            </Card>

            {/* Scale Settings */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Scale Settings</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="scale">Scale Factor</Label>
                  <Input
                    id="scale"
                    type="number"
                    step="0.01"
                    value={scale}
                    onChange={(e) => setScale(parseFloat(e.target.value) || 1)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="unit">Unit</Label>
                  <Input
                    id="unit"
                    value={scaleUnit}
                    onChange={(e) => setScaleUnit(e.target.value)}
                  />
                </div>
                <Button
                  size="sm"
                  onClick={() =>
                    updateProjectMutation.mutate({
                      id: projectId,
                      scale: scale.toString(),
                      scaleUnit,
                    })
                  }
                  className="w-full"
                >
                  Save Scale
                </Button>
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
                  <div className="space-y-2">
                    {measurements?.map((measurement) => (
                      <div
                        key={measurement.id}
                        className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-accent/50 transition-colors"
                      >
                        <div className="flex items-center gap-3 flex-1">
                          <div
                            className="w-4 h-4 rounded"
                            style={{ backgroundColor: measurement.color }}
                          />
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm truncate">{measurement.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {measurement.area} {scaleUnit}²
                            </p>
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            if (confirm("Delete this measurement?")) {
                              deleteMeasurementMutation.mutate({ id: measurement.id });
                            }
                          }}
                        >
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </div>
                    ))}
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
              Area: {calculateArea(currentPolygon).toFixed(2)} {scaleUnit}²
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="measurement-name">Measurement Name</Label>
            <Input
              id="measurement-name"
              value={measurementName}
              onChange={(e) => setMeasurementName(e.target.value)}
              placeholder="e.g., North Wing"
              className="mt-2"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsNameDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveMeasurement} disabled={createMeasurementMutation.isPending}>
              {createMeasurementMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
