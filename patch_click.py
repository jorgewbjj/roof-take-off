with open('client/src/pages/MeasurementCanvas.tsx', 'r') as f:
    content = f.read()

# Find the exact start of handleCanvasClick body
old_click_body = '''  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = overlayCanvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Text mode: place a new text annotation on click'''

new_click_body = '''  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
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
          bubbleW, bubbleH, text: 'Label',
          color: '#fef9c3', textColor: '#1e293b',
        });
      }
      return;
    }

    // Text mode: place a new text annotation on click'''

if old_click_body in content:
    content = content.replace(old_click_body, new_click_body, 1)
    print("Click handlers inserted")
else:
    print("ERROR: could not find handleCanvasClick body")

# ─── Also add scroll handler for dimension line offset adjustment ───
# Find the handleWheel function and add dim offset adjustment
old_wheel_end = '''    zoomLevelRef.current = newZoom;
    panOffsetRef.current = { x: newPanX, y: newPanY };
    setZoomLevel(newZoom);
    setPanOffset({ x: newPanX, y: newPanY });
  };'''

new_wheel_end = '''    // If in dim step 2 (setting offset), use scroll to adjust offset instead of zooming
    if (isDimMode && dimStep === 2) {
      const offsetDelta = e.deltaY > 0 ? -5 : 5;
      setDimOffsetPx(prev => prev + offsetDelta);
      return;
    }

    zoomLevelRef.current = newZoom;
    panOffsetRef.current = { x: newPanX, y: newPanY };
    setZoomLevel(newZoom);
    setPanOffset({ x: newPanX, y: newPanY });
  };'''

if old_wheel_end in content:
    content = content.replace(old_wheel_end, new_wheel_end, 1)
    print("Wheel handler updated")
else:
    print("ERROR: could not find wheel end")

# ─── Add toolbar buttons for new tools ───
# Find the Text button and add new tool buttons after it
old_text_btn = '''            <Button
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
            </Button>'''

new_text_btn = '''            <Button
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
              variant={isRectMode ? "default" : "outline"}
              size="sm"
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
              className="min-w-[44px] min-h-[44px] md:min-h-0"
            >
              <Square className="w-4 h-4 mr-1" />
              <span className="hidden sm:inline">{isRectMode ? "Stop Rect" : "Rect"}</span>
            </Button>
            <Button
              variant={isDimMode ? "default" : "outline"}
              size="sm"
              onClick={() => {
                const next = !isDimMode;
                setIsDimMode(next);
                if (next) {
                  setIsDrawing(false); setIsEditMode(false); setIsCountingMode(false);
                  setIsTextMode(false); setIsRectMode(false); setIsCalloutMode(false); setIsCutoutMode(false);
                  setCurrentPolygon([]); setDimStep(0); setDimPoint1(null); setDimPoint2(null);
                } else { setDimStep(0); setDimPoint1(null); setDimPoint2(null); }
              }}
              title="Dimension line — click 2 points, scroll to set offset, click to save"
              className="min-w-[44px] min-h-[44px] md:min-h-0"
            >
              <Ruler className="w-4 h-4 mr-1" />
              <span className="hidden sm:inline">{isDimMode ? "Stop Dim" : "Dim"}</span>
            </Button>
            <Button
              variant={isCalloutMode ? "default" : "outline"}
              size="sm"
              onClick={() => {
                const next = !isCalloutMode;
                setIsCalloutMode(next);
                if (next) {
                  setIsDrawing(false); setIsEditMode(false); setIsCountingMode(false);
                  setIsTextMode(false); setIsRectMode(false); setIsDimMode(false); setIsCutoutMode(false);
                  setCurrentPolygon([]); setCalloutStep(0); setCalloutAnchor(null);
                } else { setCalloutStep(0); setCalloutAnchor(null); }
              }}
              title="Callout bubble — click anchor point, then click to place label"
              className="min-w-[44px] min-h-[44px] md:min-h-0"
            >
              <MessageSquare className="w-4 h-4 mr-1" />
              <span className="hidden sm:inline">{isCalloutMode ? "Stop Callout" : "Callout"}</span>
            </Button>'''

if old_text_btn in content:
    content = content.replace(old_text_btn, new_text_btn, 1)
    print("Toolbar buttons added")
else:
    print("ERROR: could not find text button")

# ─── Add "Add Cutout" button in sidebar measurement items ───
# Find the delete button in the measurement item list and add a cutout button before it
old_delete_btn_area = '''                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteMeasurementMutation.mutate({ id: m.id });
                          }}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>'''

new_delete_btn_area = '''                        {m.type === 'area' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 text-muted-foreground hover:text-orange-500"
                            title="Add cutout (subtract area)"
                            onClick={(e) => {
                              e.stopPropagation();
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
                              toast("Draw the cutout polygon (HVAC unit, skylight, etc.)", { duration: 4000 });
                            }}
                          >
                            <Scissors className="w-3 h-3" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteMeasurementMutation.mutate({ id: m.id });
                          }}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>'''

if old_delete_btn_area in content:
    content = content.replace(old_delete_btn_area, new_delete_btn_area, 1)
    print("Cutout button in sidebar added")
else:
    print("ERROR: could not find delete button in sidebar")

# ─── Add Escape key handler for new tools ───
old_escape = '''      if (e.key === "Escape") {
        if (isDrawing) {'''

new_escape = '''      if (e.key === "Escape") {
        // Cancel new tools
        if (isRectMode) { setIsRectMode(false); setRectFirstPoint(null); return; }
        if (isDimMode) { setIsDimMode(false); setDimStep(0); setDimPoint1(null); setDimPoint2(null); return; }
        if (isCalloutMode) { setIsCalloutMode(false); setCalloutStep(0); setCalloutAnchor(null); return; }
        if (isCutoutMode) { setIsCutoutMode(false); setCutoutParentId(null); setIsDrawing(false); setCurrentPolygon([]); return; }
        if (isDrawing) {'''

if old_escape in content:
    content = content.replace(old_escape, new_escape, 1)
    print("Escape handler updated")
else:
    print("ERROR: could not find Escape handler")

with open('client/src/pages/MeasurementCanvas.tsx', 'w') as f:
    f.write(content)
print("All done")
