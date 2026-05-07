/**
 * Tests for custom (user-defined) measurement categories.
 *
 * Covers: create, list, update (name + measurementType), delete, and
 * duplicate-prevention logic (including type-change on duplicate).
 *
 * The db module is mocked so tests run without a live database.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrpcContext } from "./_core/context";

// ---------------------------------------------------------------------------
// Mock the db module before importing the router
// ---------------------------------------------------------------------------
vi.mock("./db", () => ({
  getUserCountingCategories: vi.fn(),
  createCountingCategory: vi.fn(),
  updateCountingCategory: vi.fn(),
  deleteCountingCategory: vi.fn(),
  // Stub out other helpers used by the router at import time
  getUserProjects: vi.fn(),
  createProject: vi.fn(),
  getProjectById: vi.fn(),
  updateProject: vi.fn(),
  deleteProject: vi.fn(),
  getProjectMeasurements: vi.fn(),
  createMeasurement: vi.fn(),
  updateMeasurement: vi.fn(),
  deleteMeasurement: vi.fn(),
  updateMeasurementIfOwned: vi.fn(),
  deleteMeasurementIfOwned: vi.fn(),
  getUserByOpenId: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
}));

import * as db from "./db";
import { appRouter } from "./routers";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function makeCtx(userId = 42): TrpcContext {
  const user: AuthenticatedUser = {
    id: userId,
    openId: `user-${userId}`,
    email: `user${userId}@example.com`,
    name: `User ${userId}`,
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

function makeCategory(
  id: number,
  name: string,
  measurementType: "area" | "linear" | "count" = "count"
) {
  return { id, userId: 42, name, measurementType, createdAt: new Date() };
}

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------
describe("countingCategories.list", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the user's saved categories", async () => {
    const mockCategories = [
      makeCategory(1, "Vents", "count"),
      makeCategory(2, "Drains", "linear"),
    ];
    vi.mocked(db.getUserCountingCategories).mockResolvedValue(mockCategories);

    const caller = appRouter.createCaller(makeCtx(42));
    const result = await caller.countingCategories.list();

    expect(db.getUserCountingCategories).toHaveBeenCalledWith(42);
    expect(result).toEqual(mockCategories);
  });

  it("returns an empty array when the user has no custom categories", async () => {
    vi.mocked(db.getUserCountingCategories).mockResolvedValue([]);

    const caller = appRouter.createCaller(makeCtx(42));
    const result = await caller.countingCategories.list();

    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------
describe("countingCategories.create", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a new area category and returns its id", async () => {
    vi.mocked(db.getUserCountingCategories).mockResolvedValue([]);
    vi.mocked(db.createCountingCategory).mockResolvedValue(99);

    const caller = appRouter.createCaller(makeCtx(42));
    const result = await caller.countingCategories.create({
      name: "Skylights",
      measurementType: "area",
    });

    expect(db.createCountingCategory).toHaveBeenCalledWith({
      userId: 42,
      name: "Skylights",
      measurementType: "area",
    });
    expect(result).toEqual({ id: 99 });
  });

  it("creates a new linear category", async () => {
    vi.mocked(db.getUserCountingCategories).mockResolvedValue([]);
    vi.mocked(db.createCountingCategory).mockResolvedValue(100);

    const caller = appRouter.createCaller(makeCtx(42));
    const result = await caller.countingCategories.create({
      name: "Flashing",
      measurementType: "linear",
    });

    expect(db.createCountingCategory).toHaveBeenCalledWith({
      userId: 42,
      name: "Flashing",
      measurementType: "linear",
    });
    expect(result).toEqual({ id: 100 });
  });

  it("defaults measurementType to 'count' when not specified", async () => {
    vi.mocked(db.getUserCountingCategories).mockResolvedValue([]);
    vi.mocked(db.createCountingCategory).mockResolvedValue(101);

    const caller = appRouter.createCaller(makeCtx(42));
    await caller.countingCategories.create({ name: "Pipes" });

    expect(db.createCountingCategory).toHaveBeenCalledWith(
      expect.objectContaining({ measurementType: "count" })
    );
  });

  it("trims whitespace from the category name before saving", async () => {
    vi.mocked(db.getUserCountingCategories).mockResolvedValue([]);
    vi.mocked(db.createCountingCategory).mockResolvedValue(102);

    const caller = appRouter.createCaller(makeCtx(42));
    await caller.countingCategories.create({ name: "  Flashings  ", measurementType: "linear" });

    expect(db.createCountingCategory).toHaveBeenCalledWith({
      userId: 42,
      name: "Flashings",
      measurementType: "linear",
    });
  });

  it("returns the existing id without creating a duplicate (case-insensitive)", async () => {
    const existing = [makeCategory(7, "Vents", "count")];
    vi.mocked(db.getUserCountingCategories).mockResolvedValue(existing);

    const caller = appRouter.createCaller(makeCtx(42));
    const result = await caller.countingCategories.create({
      name: "vents",
      measurementType: "count",
    });

    expect(db.createCountingCategory).not.toHaveBeenCalled();
    expect(result).toEqual({ id: 7 });
  });

  it("updates the measurementType when a duplicate name is submitted with a different type", async () => {
    const existing = [makeCategory(7, "Vents", "count")];
    vi.mocked(db.getUserCountingCategories).mockResolvedValue(existing);
    vi.mocked(db.updateCountingCategory).mockResolvedValue(undefined);

    const caller = appRouter.createCaller(makeCtx(42));
    const result = await caller.countingCategories.create({
      name: "Vents",
      measurementType: "area", // changed from 'count' to 'area'
    });

    // Should update the type, not create a new record
    expect(db.updateCountingCategory).toHaveBeenCalledWith(7, 42, {
      measurementType: "area",
    });
    expect(db.createCountingCategory).not.toHaveBeenCalled();
    expect(result).toEqual({ id: 7 });
  });

  it("rejects an empty name with a validation error", async () => {
    const caller = appRouter.createCaller(makeCtx(42));
    await expect(
      caller.countingCategories.create({ name: "" })
    ).rejects.toThrow();
  });

  it("rejects an invalid measurementType", async () => {
    const caller = appRouter.createCaller(makeCtx(42));
    await expect(
      caller.countingCategories.create({
        name: "Test",
        measurementType: "invalid" as "area",
      })
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------
describe("countingCategories.update", () => {
  beforeEach(() => vi.clearAllMocks());

  it("updates the category name and type", async () => {
    vi.mocked(db.updateCountingCategory).mockResolvedValue(undefined);

    const caller = appRouter.createCaller(makeCtx(42));
    const result = await caller.countingCategories.update({
      id: 5,
      name: "Skylights Updated",
      measurementType: "area",
    });

    expect(db.updateCountingCategory).toHaveBeenCalledWith(5, 42, {
      name: "Skylights Updated",
      measurementType: "area",
    });
    expect(result).toEqual({ success: true });
  });

  it("updates only the measurementType without changing the name", async () => {
    vi.mocked(db.updateCountingCategory).mockResolvedValue(undefined);

    const caller = appRouter.createCaller(makeCtx(42));
    const result = await caller.countingCategories.update({
      id: 5,
      measurementType: "linear",
    });

    expect(db.updateCountingCategory).toHaveBeenCalledWith(5, 42, {
      measurementType: "linear",
    });
    expect(result).toEqual({ success: true });
  });

  it("rejects an empty name with a validation error", async () => {
    const caller = appRouter.createCaller(makeCtx(42));
    await expect(
      caller.countingCategories.update({ id: 5, name: "" })
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// delete
// ---------------------------------------------------------------------------
describe("countingCategories.delete", () => {
  beforeEach(() => vi.clearAllMocks());

  it("deletes the category owned by the user", async () => {
    vi.mocked(db.deleteCountingCategory).mockResolvedValue(undefined);

    const caller = appRouter.createCaller(makeCtx(42));
    const result = await caller.countingCategories.delete({ id: 7 });

    expect(db.deleteCountingCategory).toHaveBeenCalledWith(7, 42);
    expect(result).toEqual({ success: true });
  });
});
