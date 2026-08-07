with open('client/src/pages/MeasurementCanvas.tsx', 'r') as f:
    content = f.read()

# ─── 3. Add helper functions and canvas rendering after doRedrawRef.current = _doRedrawOverlay ───
insert_after_doredraw = '  doRedrawRef.current = _doRedrawOverlay;'

helpers_and_rendering = '''

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
  };'''

if insert_after_doredraw in content:
    content = content.replace(insert_after_doredraw, insert_after_doredraw + helpers_and_rendering, 1)
    print("Helpers inserted:", "drawDimensionLineOnCanvas" in content)
else:
    print("ERROR: could not find doRedrawRef insert point")

# ─── 4. Insert new tool rendering into _doRedrawOverlay just before the crosshair cursor section ───
crosshair_marker = '    // Draw crosshair cursor\n    if ((isDrawing || isCalibrating) && cursorPosition) {'

new_rendering = '''    // Draw cutouts (hatched polygons with dashed red border)
    cutoutsList.forEach((cutout) => {
      const coords = cutout.coordinates as Point[];
      if (coords.length < 3) return;
      const sc = coords.map((p: Point) => ({ x: p.x * zoomLevel, y: p.y * zoomLevel }));
      ctx.save();
      ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
      ctx.beginPath(); ctx.moveTo(sc[0].x, sc[0].y);
      sc.forEach((p: Point) => ctx.lineTo(p.x, p.y)); ctx.closePath(); ctx.stroke();
      ctx.save(); ctx.clip();
      ctx.strokeStyle = 'rgba(239,68,68,0.35)'; ctx.lineWidth = 1; ctx.setLineDash([]);
      const mnX = Math.min(...sc.map((p: Point) => p.x)); const mxX = Math.max(...sc.map((p: Point) => p.x));
      const mnY = Math.min(...sc.map((p: Point) => p.y)); const mxY = Math.max(...sc.map((p: Point) => p.y));
      for (let hx = mnX - (mxY - mnY); hx < mxX + (mxY - mnY); hx += 10) {
        ctx.beginPath(); ctx.moveTo(hx, mnY); ctx.lineTo(hx + (mxY - mnY), mxY); ctx.stroke();
      }
      ctx.restore();
      const ccx = sc.reduce((s: number, p: Point) => s + p.x, 0) / sc.length;
      const ccy = sc.reduce((s: number, p: Point) => s + p.y, 0) / sc.length;
      ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 3; ctx.lineJoin = 'round';
      ctx.strokeText(`\u2212${parseFloat(String(cutout.area)).toFixed(1)} ${scaleUnit}\u00b2`, ccx, ccy);
      ctx.fillStyle = '#ef4444';
      ctx.fillText(`\u2212${parseFloat(String(cutout.area)).toFixed(1)} ${scaleUnit}\u00b2`, ccx, ccy);
      ctx.restore();
    });

    // Draw saved dimension lines
    dimensionLinesList.forEach((dim) => {
      const dist = calculateDistance({ x: dim.x1, y: dim.y1 }, { x: dim.x2, y: dim.y2 });
      const label = dim.customLabel || `${dist.toFixed(2)} ${scaleUnit}`;
      drawDimensionLineOnCanvas(ctx, dim.x1, dim.y1, dim.x2, dim.y2, dim.offsetPx, label, dim.color, zoomLevel);
    });

    // Draw saved callout bubbles
    calloutsList.forEach((callout) => {
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
      ctx.strokeText(`${rw.toFixed(1)} \u00d7 ${rh.toFixed(1)} ${scaleUnit}`, rmx, rmy);
      ctx.fillStyle = selectedColor;
      ctx.fillText(`${rw.toFixed(1)} \u00d7 ${rh.toFixed(1)} ${scaleUnit}`, rmx, rmy);
      ctx.restore();
    }

    // Draw crosshair cursor
    if ((isDrawing || isCalibrating || isRectMode || isDimMode || isCalloutMode || isCutoutMode) && cursorPosition) {'''

if crosshair_marker in content:
    content = content.replace(crosshair_marker, new_rendering, 1)
    print("Canvas rendering inserted:", "cutoutsList.forEach" in content)
else:
    print("ERROR: could not find crosshair marker")
    # Show what's near that area
    idx = content.find("Draw crosshair cursor")
    print("Found at:", idx, "context:", repr(content[idx-50:idx+100]))

with open('client/src/pages/MeasurementCanvas.tsx', 'w') as f:
    f.write(content)
print("Done")
