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
