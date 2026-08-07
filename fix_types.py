with open('client/src/pages/MeasurementCanvas.tsx', 'r') as f:
    content = f.read()

# Import the types from schema
old_import_trpc = 'import { trpc } from "@/lib/trpc";'
# Check if we need to add type imports
if 'import type { Cutout' not in content:
    content = content.replace(
        old_import_trpc,
        old_import_trpc + '\nimport type { Cutout, DimensionLine, Callout } from "../../../drizzle/schema";'
    )
    print("Added type imports")

# Fix the forEach callbacks with explicit types
content = content.replace(
    '    cutoutsList.forEach((cutout) => {',
    '    cutoutsList.forEach((cutout: Cutout) => {'
)
content = content.replace(
    '    dimensionLinesList.forEach((dim) => {',
    '    dimensionLinesList.forEach((dim: DimensionLine) => {'
)
content = content.replace(
    '    calloutsList.forEach((callout) => {',
    '    calloutsList.forEach((callout: Callout) => {'
)

print("Types fixed:", 'cutout: Cutout' in content, 'dim: DimensionLine' in content, 'callout: Callout' in content)

with open('client/src/pages/MeasurementCanvas.tsx', 'w') as f:
    f.write(content)
print("Done")
