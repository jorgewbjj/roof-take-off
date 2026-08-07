with open('client/src/pages/MeasurementCanvas.tsx', 'r') as f:
    content = f.read()

# ─── Wheel handler: add dim offset adjustment ───
old_wheel = '''    // Update both refs immediately so rapid scroll events see fresh values
    zoomLevelRef.current = newZoom;
    panOffsetRef.current = { x: newPanX, y: newPanY };

    setZoomLevel(newZoom);
    setPanOffset({ x: newPanX, y: newPanY });
  };'''

new_wheel = '''    // If in dim step 2 (setting offset), use scroll to adjust offset instead of zooming
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
  };'''

if old_wheel in content:
    content = content.replace(old_wheel, new_wheel, 1)
    print("Wheel handler updated")
else:
    print("ERROR: wheel handler not found")

# ─── Escape handler: add new tool cancellation ───
old_escape = '''      if (e.key === 'Escape') {
        e.preventDefault();
        
        // Stop counting mode
        if (isCountingMode) {'''

new_escape = '''      if (e.key === 'Escape') {
        e.preventDefault();

        // Cancel new annotation tools
        if (isRectMode) { setIsRectMode(false); setRectFirstPoint(null); toast('Rectangle cancelled'); return; }
        if (isDimMode) { setIsDimMode(false); setDimStep(0); setDimPoint1(null); setDimPoint2(null); toast('Dimension cancelled'); return; }
        if (isCalloutMode) { setIsCalloutMode(false); setCalloutStep(0); setCalloutAnchor(null); toast('Callout cancelled'); return; }
        if (isCutoutMode) { setIsCutoutMode(false); setCutoutParentId(null); setIsDrawing(false); setCurrentPolygon([]); toast('Cutout cancelled'); return; }
        
        // Stop counting mode
        if (isCountingMode) {'''

if old_escape in content:
    content = content.replace(old_escape, new_escape, 1)
    print("Escape handler updated")
else:
    print("ERROR: escape handler not found")

# ─── Sidebar: add cutout button next to delete button ───
old_delete = '''                                        className="h-7 w-7 p-0"
                                        onClick={() => {
                                          if (confirm("Delete this measurement?")) {
                                            deleteMeasurementMutation.mutate({ id: measurement.id });
                                          }
                                        }}
                                      >
                                        <Trash2 className="w-3.5 h-3.5 text-destructive" />
                                      </Button>'''

new_delete = '''                                        className="h-7 w-7 p-0"
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
                                      )}'''

if old_delete in content:
    content = content.replace(old_delete, new_delete, 1)
    print("Cutout button in sidebar added")
else:
    print("ERROR: sidebar delete button not found")

with open('client/src/pages/MeasurementCanvas.tsx', 'w') as f:
    f.write(content)
print("All done")
