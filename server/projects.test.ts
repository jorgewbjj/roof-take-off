import { describe, expect, it, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import * as db from "./db";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(userId: number = 1): TrpcContext {
  const user: AuthenticatedUser = {
    id: userId,
    openId: `test-user-${userId}`,
    email: `user${userId}@example.com`,
    name: `Test User ${userId}`,
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  const ctx: TrpcContext = {
    user,
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

describe("Projects Router", () => {
  describe("projects.list", () => {
    it("returns empty array for user with no projects", async () => {
      const ctx = createAuthContext(999);
      const caller = appRouter.createCaller(ctx);

      const projects = await caller.projects.list();

      expect(Array.isArray(projects)).toBe(true);
      expect(projects.length).toBe(0);
    });

    it("returns projects for authenticated user", async () => {
      const ctx = createAuthContext(1);
      const caller = appRouter.createCaller(ctx);

      const projects = await caller.projects.list();

      expect(Array.isArray(projects)).toBe(true);
    });
  });

  describe("projects.update", () => {
    it("updates project name successfully", async () => {
      const ctx = createAuthContext(1);
      const caller = appRouter.createCaller(ctx);

      // First, get existing projects to find one to update
      const projects = await caller.projects.list();
      
      if (projects.length > 0) {
        const projectId = projects[0].id;
        const newName = "Updated Project Name";

        const result = await caller.projects.update({
          id: projectId,
          name: newName,
        });

        expect(result.success).toBe(true);

        // Verify the update
        const updatedProject = await caller.projects.get({ id: projectId });
        expect(updatedProject?.name).toBe(newName);
      }
    });

    it("updates project scale settings", async () => {
      const ctx = createAuthContext(1);
      const caller = appRouter.createCaller(ctx);

      const projects = await caller.projects.list();
      
      if (projects.length > 0) {
        const projectId = projects[0].id;

        const result = await caller.projects.update({
          id: projectId,
          scale: "2.5",
          scaleUnit: "m",
        });

        expect(result.success).toBe(true);

        const updatedProject = await caller.projects.get({ id: projectId });
        expect(parseFloat(updatedProject?.scale || "0")).toBe(2.5);
        expect(updatedProject?.scaleUnit).toBe("m");
      }
    });
  });
});

describe("Measurements Router", () => {
  describe("measurements.create", () => {
    it("creates a measurement with valid polygon data", async () => {
      const ctx = createAuthContext(1);
      const caller = appRouter.createCaller(ctx);

      // Get a project to add measurement to
      const projects = await caller.projects.list();
      
      if (projects.length > 0) {
        const projectId = projects[0].id;

        const result = await caller.measurements.create({
          projectId,
          name: "Test Area",
          color: "#3b82f6",
          area: "150.50",
          coordinates: [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 100, y: 100 },
            { x: 0, y: 100 },
          ],
        });

        expect(result.id).toBeDefined();
        expect(typeof result.id).toBe("number");
      }
    });
  });

  describe("measurements.list", () => {
    it("returns measurements for a project", async () => {
      const ctx = createAuthContext(1);
      const caller = appRouter.createCaller(ctx);

      const projects = await caller.projects.list();
      
      if (projects.length > 0) {
        const projectId = projects[0].id;

        const measurements = await caller.measurements.list({ projectId });

        expect(Array.isArray(measurements)).toBe(true);
      }
    });
  });

  describe("measurements.update", () => {
    it("updates measurement name and color", async () => {
      const ctx = createAuthContext(1);
      const caller = appRouter.createCaller(ctx);

      const projects = await caller.projects.list();
      
      if (projects.length > 0) {
        const projectId = projects[0].id;
        const measurements = await caller.measurements.list({ projectId });

        if (measurements.length > 0) {
          const measurementId = measurements[0].id;

          const result = await caller.measurements.update({
            id: measurementId,
            name: "Updated Area Name",
            color: "#ef4444",
          });

          expect(result.success).toBe(true);
        }
      }
    });
  });
});

describe("Database Helpers", () => {
  describe("getUserProjects", () => {
    it("returns array of projects", async () => {
      const projects = await db.getUserProjects(1);
      expect(Array.isArray(projects)).toBe(true);
    });
  });

  describe("getProjectMeasurements", () => {
    it("returns array of measurements", async () => {
      const projects = await db.getUserProjects(1);
      
      if (projects.length > 0) {
        const measurements = await db.getProjectMeasurements(projects[0].id);
        expect(Array.isArray(measurements)).toBe(true);
      }
    });
  });
});
