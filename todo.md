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

## New Features
- [x] Backspace key to undo last point during drawing
- [x] Measurement categories - allow same name for multiple measurements
- [x] Group measurements by name/category in sidebar
- [x] Show total linear feet per category
- [x] Allow continuing to add measurements to existing categories

## Category Dropdown
- [x] Add dropdown with preset categories in name dialog
- [x] Include categories: Drip Edge, Walk Pads, Coping, Gutter, Roofing Field
- [x] Add "Other" option that shows text input for custom categories
- [x] Make dropdown the default input method

## Category Layer Visibility
- [x] Add eye icon toggle button to each category header
- [x] Track visibility state per category name using Set
- [x] Hide/show measurements on canvas based on category visibility
- [x] Persist visibility state during session

## Zoom Control Refinement
- [x] Change zoom increment from 10% to 1% for smoother control
- [x] Update scroll wheel zoom increment - Changed from 0.1 to 0.01
- [x] Update zoom in/out button increment - Changed from 0.1 to 0.01

## Panning During Drawing
- [x] Fix middle mouse button panning - not working during drawing mode
- [x] Debug why panning doesn't activate when drawing - Fixed else-if blocking panning
- [x] Test and verify panning works while measuring - Both actions now independent

## Scroll Behavior Fix
- [x] Prevent page scrolling when mouse is over PDF canvas
- [x] Allow scrolling only in the sidebar area
- [x] Keep zoom functionality working with mouse wheel over canvas

## Sidebar and Zoom Improvements
- [x] Fix right sidebar to scroll independently from canvas - Added flex-shrink-0
- [x] Add auto-fit zoom when opening project - Calculates optimal zoom on PDF load
- [x] Calculate optimal zoom to fit PDF within viewport - Considers container dimensions

## PDF Preview and Cursor-Focused Zoom
- [x] Add PDF preview thumbnails to projects list page
- [x] Generate thumbnail from first page of PDF - Created PDFThumbnail component
- [x] Display thumbnail in project card - Replaced FileText icon with actual PDF preview
- [x] Implement cursor-focused zoom (zoom centered on mouse position)
- [x] Update zoom in/out to maintain cursor position as zoom center - Uses zoomAtPoint function
- [x] Update scroll wheel zoom to center on cursor - Passes clientX/clientY to zoomAtPoint

## Zoom Smoothness and Layout Improvements
- [x] Fix cursor-focused zoom smoothness issue - Used functional setState to avoid stale closure
- [x] Debug pan offset calculation during zoom - Fixed with prevPanOffset reference
- [x] Move scale controls to top header - Compact toolbar with all controls
- [x] Move zoom controls to top header - Horizontal button layout
- [x] Move drawing tools to top header - Minimalist design
- [x] Keep only measurements list in right sidebar - Removed all control cards
- [x] Make layout minimalist to maximize canvas space - Clean professional interface

## PDF Export Feature
- [x] Add PDF generation for measurement report
- [x] Show project name and date in PDF header
- [x] List each category with total linear feet (for lines) or square feet (for areas)
- [x] Use minimalist design with clean typography
- [x] Add download button in Export dropdown

## Sticky Header Fix
- [x] Make header toolbar sticky/fixed at top of page
- [x] Ensure header stays visible when scrolling canvas
- [x] Adjust canvas container to account for fixed header height

## Zoom Behavior Fix
- [x] Fix PDF drifting/moving when zooming in/out
- [x] Keep PDF centered and stable in canvas position during zoom
- [x] Ensure all measurements stay aligned with PDF during zoom
- [x] Verify drawing, editing, and panning still work correctly after fix

## Thumbnail Preview Fix
- [x] Fix PDF thumbnail preview not showing on projects list page
- [x] Investigate PDFThumbnail component rendering issue
- [x] Ensure thumbnails load correctly for all projects
- [x] Verify everything else remains unchanged

## Point Counting Feature
- [x] Add new measurement type: "point" for counting items
- [x] Update database schema to support point measurements (count field)
- [x] Add "Curbs" category as point measurement type
- [x] Add "Pipes" category as point measurement type
- [x] Implement click-to-place-marker functionality in Draw mode
- [x] Display count total for each point category (e.g., "20 curbs")
- [x] Update CSV export to include point counts
- [x] Update PDF export to include point counts (e.g., "Curbs: 20 items")
- [x] Ensure all existing features (area, line measurements) continue to work
- [x] Test drawing, editing, calibration, zoom, and export with point measurements

## Count Button Feature
- [x] Add "Count" button next to Draw button in toolbar
- [x] Clicking Count opens category selector dialog
- [x] Show only counting categories (Curbs, Pipes, Other) in dialog
- [x] After selecting category, enter counting mode (same as Draw with point category)
- [x] Show visual feedback that counting mode is active
- [x] Ensure all existing features continue to work

## Visible Count Markers Feature
- [x] Show visible markers on canvas where each count item was clicked
- [x] Use same style as area/line measurements (colored circles with X)
- [x] Add individual count markers to measurements list in sidebar
- [x] Integrate count markers into layer visibility system (eye icon to hide/show)
- [x] Ensure markers can be individually deleted like other measurements
- [x] Verify all existing features continue to work

## Marker Visibility Bug Fix
- [x] Investigate why curb and pipe markers are not showing on canvas
- [x] Fix marker rendering logic in redrawOverlay function
- [x] Verify markers are visible for both Curbs and Pipes categories
- [x] Test that all other measurements (areas, lines) still render correctly

## Custom Counting Categories Feature
- [x] Create database table for custom counting categories
- [x] Add user_id to categories table to associate with owner
- [x] Create backend API to fetch user's custom categories
- [x] Create backend API to create new custom category
- [x] Update Count dialog to show both preset and custom categories
- [x] Add input field in Count dialog for creating new custom category when "Other (Custom)" is selected
- [x] Save new custom category to database when created
- [x] Load custom categories from database when opening Count dialog
- [x] Test creating custom categories and using them across different projects
- [x] Verify all existing features continue to work

## Custom Category Counting Behavior Fix
- [x] Fix custom categories created via Count dialog to work as point-counting categories
- [x] Ensure custom categories use click-to-place-marker behavior (not shape/line drawing)
- [x] Update category type detection logic to recognize all custom categories as counting types
- [x] Test creating new custom category and verify it places markers on click
- [x] Verify preset categories (Curbs, Pipes) still work correctly
- [x] Ensure all existing features continue to work

## Draw/Count Button Separation Fix
- [x] Fix Draw button to only work for drawing shapes and lines (polygon/line mode)
- [x] Ensure Draw button never enters counting mode
- [x] Keep Count button exclusively for point-counting functionality
- [x] Test Draw button with all regular categories (Drip Edge, Walk Pads, etc.)
- [x] Test Count button with all counting categories (Curbs, Pipes, custom categories)
- [x] Verify both buttons work independently without interfering with each other

## Collapsible Categories in Sidebar
- [x] Add expand/collapse state for each category
- [x] Add arrow button next to category header to toggle expansion
- [x] By default, categories should be collapsed (markers hidden)
- [x] Clicking arrow expands category to show individual markers
- [x] Preserve expand/collapse state during session
- [x] Ensure category-level actions (eye icon, delete) still work when collapsed
- [x] Test with multiple categories and many markers

## Mouse Wheel Zoom Fix
- [x] Prevent page scroll when mouse wheel is used over canvas
- [x] Make mouse wheel only zoom in/out on canvas
- [x] Ensure zoom works smoothly without page scrolling
- [x] Test in both drawing and counting modes

## Bug Fixes - Counting Feature
- [x] Fix new categories sometimes not saving when counting
- [x] Fix markers not showing on canvas after placement

## Keyboard Shortcuts
- [x] Add Escape key shortcut to stop drawing or counting mode

## Mouse Wheel Behavior
- [x] Disable page scrolling with mouse wheel except in sidebar
- [x] Mouse wheel should only zoom canvas in main area

## Zoom Improvements
- [x] Implement zoom-to-cursor (zoom centers on mouse pointer position)
