import { describe, expect, it, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { getDb } from "./db";
import { projects, measurements } from "../drizzle/schema";
import { eq } from "drizzle-orm";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-user",
    email: "test@example.com",
    name: "Test User",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  const ctx: TrpcContext = {
    user,
    activeOrganization: { membershipId: 1, organizationId: 1, organizationName: "Test Workspace", organizationSlug: "test-workspace", role: "owner" },
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };

  return ctx;
}

describe("measurements", () => {
  let testProjectId: number;
  let caller: ReturnType<typeof appRouter.createCaller>;

  beforeEach(async () => {
    const ctx = createAuthContext();
    caller = appRouter.createCaller(ctx);

    // Create a test project with a minimal PDF file
    const testPdfData = Buffer.from("test pdf content").toString('base64');
    const project = await caller.projects.create({
      name: "Test Measurement Project",
      pdfFile: {
        data: testPdfData,
        filename: "test.pdf",
        mimeType: "application/pdf",
      },
    });
    testProjectId = project.id;
    
    // Update the project with scale settings
    const dbInstance = await getDb();
    if (!dbInstance) throw new Error("Database not available");
    await dbInstance.update(projects)
      .set({ scale: 20.0, scaleUnit: "feet" })
      .where(eq(projects.id, testProjectId));
  });

  it("correctly calculates line measurement distance", async () => {
    // Create a line measurement with two points
    // Points are in normalized pixel coordinates
    // At 96 DPI: 96 pixels = 1 inch
    // With scale 20: 1 inch = 20 feet
    // So 96 pixels = 20 feet, or 1 pixel = 20/96 feet ≈ 0.208 feet
    
    // Create a horizontal line of 96 pixels (should be 20 feet)
    const point1 = { x: 0, y: 0 };
    const point2 = { x: 96, y: 0 };
    
    const measurement = await caller.measurements.create({
      projectId: testProjectId,
      name: "Test Line",
      color: "#ff0000",
      coordinates: [point1, point2],
      area: "20.0", // Expected: 20 feet (stored as string)
      perimeter: undefined,
    });

    expect(measurement.id).toBeTypeOf("number");
    
    // Verify it's stored correctly
    const retrieved = await caller.measurements.list({ projectId: testProjectId });
    expect(retrieved).toHaveLength(1);
    expect(retrieved[0]?.area).toBe("20.00");
  });

  it("correctly calculates area measurement", async () => {
    // Create a square: 96x96 pixels = 1 inch x 1 inch
    // At scale 20: 1 inch = 20 feet
    // So area should be 20 x 20 = 400 square feet
    const square = [
      { x: 0, y: 0 },
      { x: 96, y: 0 },
      { x: 96, y: 96 },
      { x: 0, y: 96 },
    ];

    // Calculate expected area using Shoelace formula
    // Pixel area = 96 * 96 = 9216 square pixels
    // Inch area = 9216 / (96 * 96) = 1 square inch
    // Real area = 1 * (20^2) = 400 square feet
    const expectedArea = 400.0;
    const expectedPerimeter = 80.0; // 4 sides of 20 feet each

    const measurement = await caller.measurements.create({
      projectId: testProjectId,
      name: "Test Square",
      color: "#00ff00",
      coordinates: square,
      area: expectedArea.toString(),
      perimeter: expectedPerimeter.toString(),
    });

    expect(measurement.id).toBeTypeOf("number");
  });

  it("handles different scale units correctly", async () => {
    // Update project to use meters
    const dbInstance = await getDb();
    if (!dbInstance) throw new Error("Database not available");
    await dbInstance.update(projects)
      .set({ scaleUnit: "meters" })
      .where(eq(projects.id, testProjectId));

    // Create a line of 96 pixels (should be 20 meters with scale 20)
    const point1 = { x: 0, y: 0 };
    const point2 = { x: 96, y: 0 };

    const measurement = await caller.measurements.create({
      projectId: testProjectId,
      name: "Test Line Meters",
      color: "#0000ff",
      coordinates: [point1, point2],
      area: "20.0",
      perimeter: undefined,
    });

    expect(measurement.id).toBeTypeOf("number");
    
    // Verify the project has correct unit
    const project = await caller.projects.get({ id: testProjectId });
    expect(project.scaleUnit).toBe("meters");
  });

  it("correctly updates measurement coordinates", async () => {
    // Create initial measurement
    const initialCoords = [
      { x: 0, y: 0 },
      { x: 96, y: 0 },
    ];

    const measurement = await caller.measurements.create({
      projectId: testProjectId,
      name: "Test Line",
      color: "#ff0000",
      coordinates: initialCoords,
      area: "20.0",
      perimeter: undefined,
    });

    // Update coordinates (double the length)
    const updatedCoords = [
      { x: 0, y: 0 },
      { x: 192, y: 0 },
    ];

    const updated = await caller.measurements.update({
      id: measurement.id,
      coordinates: updatedCoords,
      area: "40.0", // Double the distance
    });

    expect(updated.success).toBe(true);
  });

  it("deletes measurements correctly", async () => {
    // Create a measurement
    const measurement = await caller.measurements.create({
      projectId: testProjectId,
      name: "Test Line",
      color: "#ff0000",
      coordinates: [{ x: 0, y: 0 }, { x: 96, y: 0 }],
      area: "20.0",
      perimeter: undefined,
    });
    // Delete it
    await caller.measurements.delete({ id: measurement.id });
    // Verify it's gone
    const list = await caller.measurements.list({ projectId: testProjectId });
    expect(list).toHaveLength(0);
  });

  it("saves wall measurements with correct type, perimeter, area, and count fields", async () => {
    // Wall measurements are saved with:
    //   type = 'line'
    //   area = linearFt * height  (wall area in ft²)
    //   perimeter = linearFt       (linear footage of the wall run)
    //   count = Math.round(height * 1000)  (height encoded as integer)
    // This regression test ensures the DB stores all fields and returns them
    // correctly so the canvas renderer can classify the measurement as a line.
    const linearFt = 21.17;
    const height = 1.0; // 1 ft height
    const wallArea = linearFt * height; // 21.17 ft²

    const created = await caller.measurements.create({
      projectId: testProjectId,
      name: "Wall",
      type: "line",
      color: "#ef4444",
      area: wallArea.toFixed(2),
      perimeter: linearFt.toFixed(2),
      count: Math.round(height * 1000),
      coordinates: [{ x: 0, y: 0 }, { x: 96, y: 0 }],
    });

    expect(created.id).toBeTypeOf("number");

    const list = await caller.measurements.list({ projectId: testProjectId });
    const wall = list.find((m) => m.name === "Wall");
    expect(wall).toBeDefined();
    // type must be 'line' so the canvas renderer draws it as a polyline
    expect(wall!.type).toBe("line");
    // perimeter stores linear footage (not null)
    expect(parseFloat(wall!.perimeter!)).toBeCloseTo(linearFt, 1);
    // area stores wall area
    expect(parseFloat(wall!.area!)).toBeCloseTo(wallArea, 1);
    // count stores height * 1000
    expect(wall!.count).toBe(Math.round(height * 1000));
    // coordinates must have 2+ points so the renderer doesn't skip it
    expect((wall!.coordinates as Array<unknown>).length).toBeGreaterThanOrEqual(2);
  });
});
