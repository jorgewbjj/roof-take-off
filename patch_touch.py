with open('client/src/pages/MeasurementCanvas.tsx', 'r') as f:
    content = f.read()

# Update the touch tap condition to include new tool modes
old_tap = '        if (isTap && (isDrawing || isCountingMode)) {'
new_tap = '        if (isTap && (isDrawing || isCountingMode || isRectMode || isDimMode || isCalloutMode || isCutoutMode)) {'

if old_tap in content:
    content = content.replace(old_tap, new_tap, 1)
    print("Touch tap condition updated")
else:
    print("ERROR: could not find touch tap condition")

# Also update the cursor position update in handleTouchMove to include new modes
old_touch_cursor = '      if (isDrawing) {\n        setCursorPosition({ x, y });\n      }'
new_touch_cursor = '      if (isDrawing || isRectMode || isDimMode || isCalloutMode || isCutoutMode) {\n        setCursorPosition({ x, y });\n      }'

if old_touch_cursor in content:
    content = content.replace(old_touch_cursor, new_touch_cursor, 1)
    print("Touch cursor update condition updated")
else:
    print("ERROR: could not find touch cursor condition")

with open('client/src/pages/MeasurementCanvas.tsx', 'w') as f:
    f.write(content)
print("Done")
