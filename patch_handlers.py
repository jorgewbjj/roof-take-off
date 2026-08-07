with open('client/src/pages/MeasurementCanvas.tsx', 'r') as f:
    content = f.read()

# ─── 5. Update the main redraw useEffect to include new tool states ───
old_effect = '  }, [measurements, currentPolygon, selectedColor, scale, scaleUnit, zoomLevel, isEditMode, selectedMeasurementId, draggingVertexIndex, isCalibrating, calibrationPoints, hiddenCategories, hiddenMeasurements, textAnnotationsList, selectedTextId, isTextMode, currentPage, isDrawing, isCountingMode]);'
new_effect = '  }, [measurements, currentPolygon, selectedColor, scale, scaleUnit, zoomLevel, isEditMode, selectedMeasurementId, draggingVertexIndex, isCalibrating, calibrationPoints, hiddenCategories, hiddenMeasurements, textAnnotationsList, selectedTextId, isTextMode, currentPage, isDrawing, isCountingMode, cutoutsList, dimensionLinesList, calloutsList, selectedCalloutId, isDimMode, dimPoint1, dimPoint2, dimStep, dimOffsetPx, dimColor, isCalloutMode, calloutStep, calloutAnchor, isRectMode, rectFirstPoint, isCutoutMode]);'
if old_effect in content:
    content = content.replace(old_effect, new_effect)
    print("Effect deps updated")
else:
    print("ERROR: could not find effect deps")

# ─── 6. Update cursor-move useEffect ───
old_cursor_effect = '  }, [cursorPosition, isDrawing, isCountingMode, isCalibrating]);'
new_cursor_effect = '  }, [cursorPosition, isDrawing, isCountingMode, isCalibrating, isRectMode, isDimMode, isCalloutMode, isCutoutMode]);'
if old_cursor_effect in content:
    content = content.replace(old_cursor_effect, new_cursor_effect)
    print("Cursor effect deps updated")
else:
    print("ERROR: could not find cursor effect")

# ─── 7. Update cursor-move condition ───
old_cursor_cond = '    if (cursorPosition && (isDrawing || isCountingMode || isCalibrating)) {'
new_cursor_cond = '    if (cursorPosition && (isDrawing || isCountingMode || isCalibrating || isRectMode || isDimMode || isCalloutMode || isCutoutMode)) {'
if old_cursor_cond in content:
    content = content.replace(old_cursor_cond, new_cursor_cond)
    print("Cursor condition updated")
else:
    print("ERROR: could not find cursor condition")

# ─── 8. Add click handlers for new tools inside handleCanvasClick ───
# Find the end of the counting mode click handler and add new tool handlers before the normal drawing handler
# The normal drawing handler starts with: "  const handleCanvasClick = "
# We need to add handlers for rect, dim, callout, cutout modes

# Find the handleCanvasClick function and add mode checks at the top
old_click_start = '''  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return; // Only left clicks'''

new_click_start = '''  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return; // Only left clicks
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const rawX = e.clientX - rect.left;
    const rawY = e.clientY - rect.top;
    const normalizedX = rawX / zoomLevel;
    const normalizedY = rawY / zoomLevel;

    // ─── Rectangle Area tool ─────────────────────────────────────────────────────
    if (isRectMode) {
      if (!rectFirstPoint) {
        setRectFirstPoint({ x: normalizedX, y: normalizedY });
      } else {
        // Second click: build 4-corner polygon and open name dialog
        const x1 = rectFirstPoint.x; const y1 = rectFirstPoint.y;
        const x2 = normalizedX; const y2 = normalizedY;
        const rectPoly = [{ x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 }];
        setCurrentPolygon(rectPoly);
        setIsShapeClosed(true);
        setRectFirstPoint(null);
        setIsRectMode(false);
        setIsDrawing(true); // temporarily so saveMeasurement works
        setIsNameDialogOpen(true);
      }
      return;
    }

    // ─── Dimension Line tool ─────────────────────────────────────────────────────
    if (isDimMode) {
      if (dimStep === 0) {
        setDimPoint1({ x: normalizedX, y: normalizedY });
        setDimStep(1);
      } else if (dimStep === 1) {
        setDimPoint2({ x: normalizedX, y: normalizedY });
        setDimStep(2);
        // Step 2: user will use scroll/drag to set offset, then click to confirm
      } else if (dimStep === 2 && dimPoint1 && dimPoint2) {
        // Confirm and save
        createDimensionLineMutation.mutate({
          projectId,
          tabId: activeTabId,
          x1: dimPoint1.x, y1: dimPoint1.y,
          x2: dimPoint2.x, y2: dimPoint2.y,
          offsetPx: dimOffsetPx,
          color: dimColor,
        });
      }
      return;
    }

    // ─── Callout Bubble tool ─────────────────────────────────────────────────────
    if (isCalloutMode) {
      if (calloutStep === 0) {
        setCalloutAnchor({ x: normalizedX, y: normalizedY });
        setCalloutStep(1);
      } else if (calloutStep === 1 && calloutAnchor) {
        // Place bubble at cursor position, offset 80px right and 40px up from anchor
        const bubbleW = 160; const bubbleH = 60;
        createCalloutMutation.mutate({
          projectId,
          tabId: activeTabId,
          anchorX: calloutAnchor.x, anchorY: calloutAnchor.y,
          bubbleX: normalizedX - bubbleW / 2,
          bubbleY: normalizedY - bubbleH / 2,
          bubbleW, bubbleH,
          text: 'Label',
          color: '#fef9c3',
          textColor: '#1e293b',
        });
      }
      return;
    }

    // ─── Cutout tool ─────────────────────────────────────────────────────────────
    if (isCutoutMode) {
      // Cutout uses the normal polygon drawing — handled by the isDrawing path below
      // (isCutoutMode is set alongside isDrawing=true)
    }'''

if old_click_start in content:
    content = content.replace(old_click_start, new_click_start, 1)
    print("Click handlers added")
else:
    print("ERROR: could not find handleCanvasClick start")
    idx = content.find("const handleCanvasClick")
    print("Found at:", idx, "context:", repr(content[idx:idx+200]))

# ─── 9. Update saveMeasurement to handle cutout mode ───
# After the normal createMeasurementMutation.mutate call in saveMeasurement,
# if isCutoutMode is true, call createCutoutMutation instead
old_save = '''    createMeasurementMutation.mutate({
      projectId,
      tabId: activeTabId,
      name: measurementName,
      type,
      color: selectedColor,
      area: area.toFixed(2),
      perimeter: perimeter ? perimeter.toFixed(2) : undefined,
      coordinates: currentPolygon,
    });
    setIsNameDialogOpen(false);
  };'''

new_save = '''    if (isCutoutMode && cutoutParentId !== null) {
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
  };'''

if old_save in content:
    content = content.replace(old_save, new_save, 1)
    print("saveMeasurement updated")
else:
    print("ERROR: could not find saveMeasurement end")

with open('client/src/pages/MeasurementCanvas.tsx', 'w') as f:
    f.write(content)
print("Done")
