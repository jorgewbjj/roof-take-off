# Roof Plan Measurer - Project TODO

## Core Features
- [x] PDF upload and display functionality with canvas rendering
- [x] Interactive scale adjustment tool to calibrate measurements
- [x] Drawing tools to mark and measure areas on the PDF
- [x] Area naming system with custom labels for each measured section
- [x] Color coding system to differentiate between measured areas
- [x] Real-time area calculation in square units
- [x] Project management system to save and load multiple roof plans
- [x] Cloud storage integration for persistent project data
- [x] Measurement history and notes for each project
- [x] Export functionality for measurements and project data

## Database Schema
- [x] Projects table (id, name, userId, pdfUrl, pdfKey, scale, notes, createdAt, updatedAt)
- [x] Measurements table (id, projectId, name, color, area, coordinates, createdAt)

## UI Components
- [x] Project list/dashboard page
- [x] PDF viewer with canvas overlay
- [x] Scale calibration interface
- [x] Drawing tools toolbar
- [x] Measurement list sidebar
- [x] Project settings and notes
- [x] Export dialog

## Technical Implementation
- [x] PDF.js integration for PDF rendering
- [x] Canvas-based drawing system
- [x] Polygon area calculation algorithm
- [x] S3 file upload for PDFs
- [x] tRPC procedures for CRUD operations
- [x] Elegant design system with consistent theming

## Bug Fixes
- [x] Fix PDF upload failure issue

## Enhancements
- [x] AutoCAD-style crosshair cursor for precision drawing
- [x] Show straight lines between measurement points with distance labels
- [x] Display distance in feet for each line segment
- [x] Display area in square feet automatically when closing a shape
- [x] Real-time preview line from last point to cursor position
- [x] Add visual feedback for line measurements during drawing

## New Features
- [x] High-quality PDF rendering with increased resolution
- [x] Zoom in/out controls for better precision
- [x] Mouse wheel zoom support
- [x] Zoom level indicator
- [ ] Pan functionality when zoomed in

## Bug Fixes - Zoom Alignment
- [x] Fix measurement overlay to scale with zoom level
- [x] Ensure marked areas stay aligned with PDF when zooming
- [x] Update coordinate system to account for zoom transformations

## Critical Bug Fixes
- [x] Fix measurement position bug - areas move to different place when completed
- [x] Store coordinates in normalized format (independent of zoom level)

## UI Improvements
- [x] Change crosshair cursor color to black
- [x] Auto-save shape when closed and prompt for name immediately
- [x] Implement left-click panning to move PDF around
- [x] Make zoom smoother with smaller increments (0.1 instead of 0.25)

## New Bug Fixes
- [x] Fix PDF panning - not working properly

## New Features - Phase 2
- [x] Measurement snapping - auto-align to existing measurement vertices
- [x] Area totals summary panel showing total measured area
- [x] Escape key to complete drawing (close shape)
- [x] Visual snap indicator when near existing points
- [x] Filter area totals by color/tag

## New Features - Phase 3
- [x] Exact measurement input - type distance to create line of specific length
- [x] Input field for exact distance entry
- [x] Visual preview of exact-length line following cursor
- [x] Click to place exact-length line at desired angle
- [x] Measurement editing mode - select and modify existing measurements
- [x] Click to select measurement polygons
- [x] Drag vertices to adjust measurement shape
- [x] Delete key to remove selected measurements
- [x] Visual selection indicator (highlight selected measurement)
- [x] Delete button for selected measurements

## Bug Fixes - PDF Upload
- [x] Investigated PDF 403 CORS error when loading from CloudFront
- [x] Add proper CORS configuration to PDF.js worker
- [x] Tested storage proxy presigned URLs (limitation found - returns same public URL)
- [x] Improved error messaging for expired/inaccessible PDFs
- [x] Documented that fresh PDF uploads work correctly

## Scale System Update
- [x] Change scale format from multiplier to "1 inch = X feet"
- [x] Update scale input UI to show architectural format
- [x] Update measurement calculations to use new scale format
- [x] Database schema already supports this (no changes needed)
- [x] Test measurements with new scale system

## Scale Calibration Tool
- [x] Add calibration mode button in Scale Settings
- [x] Implement two-click point selection for known distance
- [x] Show visual line between calibration points
- [x] Add dialog to enter known distance
- [x] Calculate and apply scale factor automatically
- [x] Display calibration line distance during selection
- [x] Add cancel calibration option

## Zoom Range Fix
- [x] Increase zoom out range beyond current 50% minimum
- [x] Allow zoom out to 10% for better overview of large PDFs

## Calibration Accuracy Bug
- [x] Fix calibration so measuring the same distance returns exact calibrated value
- [x] Verify distance calculation formula matches calibration formula
- [x] Ensure zoom level doesn't affect measurement accuracy (normalized by zoom in calculateDistance)

## Middle Mouse Button Panning
- [x] Fix middle mouse button panning - not working when tested
- [x] Debug why button 1 check isn't triggering (onClick was interfering)
- [x] Added onAuxClick to prevent middle button from triggering onClick
- [x] Filter onClick to only handle left button (button 0)

## Line Measurements & Default Unit
- [x] Set feet as the default measurement unit
- [x] Allow 2-point line measurements (not just shapes)
- [x] Save line measurement when pressing Escape with 2 points
- [x] Display line length in measurement list (without ² symbol)
- [x] Store line measurements in database (distance stored in area field)
- [x] Render line measurements differently from area measurements in UI

## Perimeter Calculation
- [x] Add calculatePerimeter function for polygons
- [x] Store perimeter in database for area measurements
- [x] Display perimeter in measurement list for areas
- [x] Show perimeter in Name Dialog for area measurements
- [x] Update database schema to include perimeter field

## Critical Bug - Area Calculation
- [x] Fix area calculation producing incorrect values (20x10 showing 1.8M sq ft instead of 200)
- [x] Review calculateArea formula and scale application
- [x] Added proper pixel-to-inch-to-real-world conversion (÷96² then ×scale²)
- [x] Test with known dimensions to verify accuracy

## Line Measurement Bugs
- [x] Fix line measurement calculation (20m showing as 100m) - Fixed exact measurement mode distance conversion
- [x] Display saved line measurements on canvas (currently only in sidebar) - Added line rendering with endpoints and distance labels
- [x] Ensure feet is default unit everywhere (not meters) - Feet already set as default in state initialization
- [x] Remove meters from default options unless explicitly changed - Meters only appear when user selects them

## Calibration Verification Bug
- [x] Fix calibration - saved measurements now match calibrated distance
- [x] Fix real-time preview distance display while moving mouse - Now uses normalized coordinates
- [x] Ensure preview distance uses same calculation as saved measurements - All distance calculations consistent

## Measurement Behavior Change
- [x] Change default behavior to create line measurements (not areas)
- [x] Only create area when user explicitly closes shape by clicking start point
- [x] Remove Escape key auto-closing that creates areas - Now saves as polyline
- [x] Update Escape key to save current polyline as line measurement
- [x] Fix rendering: line measurements showing as closed filled shapes
- [x] Render line measurements as open polylines without fill - Check perimeter field to distinguish

## Distance Calculation Bug
- [x] Fix distance doubling issue - 20ft measurement saving as 40ft
- [x] Check if calculatePerimeter is counting segments twice - Created separate calculatePolylineLength
- [x] Verify polyline distance calculation logic - Lines use open path, areas use closed path

## Drawing Preview Bug
- [x] Fix preview showing closed filled triangle while drawing
- [x] Remove fill and closing path from drawing preview - Only draw consecutive segments
- [x] Only show closed shape when explicitly closed (clicked first point)
