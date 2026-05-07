import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// Mock the entire db module — routers.ts uses `import * as db from "./db"`
vi.mock("./db");

import * as db from "./db";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(userId = 1): TrpcContext {
  const user: AuthenticatedUser = {
    id: userId,
    openId: "test-user",
    email: "test@example.com",
    name: "Test User",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

const sampleProject = {
  id: 42,
  userId: 1,
  name: "Test Project",
  description: null,
  pdfUrl: null,
  pdfKey: null,
  scale: "1",
  scaleUnit: "feet",
  createdAt: new Date(),
  updatedAt: new Date(),
};

const sampleAnnotation = {
  id: 1,
  projectId: 42,
  userId: 1,
  pageNumber: 1,
  x: 100,
  y: 150,
  width: 200,
  height: 80,
  content: "Test note",
  fontSize: 24,
  textColor: "#000000",
  bgColor: "#ffffff",
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("textAnnotations.list", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.getProjectById).mockResolvedValue(sampleProject);
    vi.mocked(db.getProjectTextAnnotations).mockResolvedValue([sampleAnnotation]);
  });

  it("returns annotations for the given project", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.textAnnotations.list({ projectId: 42 });
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("Test note");
    expect(db.getProjectTextAnnotations).toHaveBeenCalledWith(42);
  });

  it("returns empty array when no annotations exist", async () => {
    vi.mocked(db.getProjectTextAnnotations).mockResolvedValue([]);
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.textAnnotations.list({ projectId: 42 });
    expect(result).toEqual([]);
  });

  it("throws when project is not found or not owned by user", async () => {
    vi.mocked(db.getProjectById).mockResolvedValue(null);
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.textAnnotations.list({ projectId: 999 })).rejects.toThrow(
      "Project not found or access denied"
    );
  });
});

describe("textAnnotations.create", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.getProjectById).mockResolvedValue(sampleProject);
    vi.mocked(db.createTextAnnotation).mockResolvedValue(1 as any);
  });

  it("creates a text annotation and returns its id", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.textAnnotations.create({
      projectId: 42,
      pageNumber: 1,
      x: 100,
      y: 150,
      width: 200,
      height: 80,
      content: "Test note",
      fontSize: 24,
      textColor: "#000000",
      bgColor: "#ffffff",
    });
    expect(result).toEqual({ id: 1 });
    expect(db.createTextAnnotation).toHaveBeenCalledOnce();
  });

  it("uses default values for optional fields when not provided", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.textAnnotations.create({
      projectId: 42,
      pageNumber: 1,
      x: 50,
      y: 60,
      width: 200,
      height: 80,
    });
    expect(result).toHaveProperty("id");
    // Verify defaults were applied in the call
    expect(db.createTextAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({ content: "Text", fontSize: 24, textColor: "#000000" })
    );
  });
});

describe("textAnnotations.update", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.getProjectById).mockResolvedValue(sampleProject);
    vi.mocked(db.updateTextAnnotation).mockResolvedValue(undefined);
  });

  it("updates content and returns success", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.textAnnotations.update({
      id: 1,
      projectId: 42,
      content: "Updated text",
    });
    expect(result).toEqual({ success: true });
    expect(db.updateTextAnnotation).toHaveBeenCalledWith(
      1,
      42,
      expect.objectContaining({ content: "Updated text" })
    );
  });

  it("updates position and returns success", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.textAnnotations.update({
      id: 1,
      projectId: 42,
      x: 300,
      y: 400,
    });
    expect(result).toEqual({ success: true });
    expect(db.updateTextAnnotation).toHaveBeenCalledWith(
      1,
      42,
      expect.objectContaining({ x: 300, y: 400 })
    );
  });
});

describe("textAnnotations.delete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.getProjectById).mockResolvedValue(sampleProject);
    vi.mocked(db.deleteTextAnnotation).mockResolvedValue(undefined);
  });

  it("deletes an annotation and returns success", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.textAnnotations.delete({ id: 1, projectId: 42 });
    expect(result).toEqual({ success: true });
    expect(db.deleteTextAnnotation).toHaveBeenCalledWith(1, 42);
  });

  it("throws when project is not found", async () => {
    vi.mocked(db.getProjectById).mockResolvedValue(null);
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.textAnnotations.delete({ id: 1, projectId: 999 })).rejects.toThrow(
      "Project not found or access denied"
    );
  });
});
