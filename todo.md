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
