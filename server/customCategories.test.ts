/**
 * Tests for custom (user-defined) measurement categories.
 *
 * These tests verify the tRPC procedures for creating, listing, and deleting
 * custom categories, including the duplicate-prevention guard.
 *
 * Because the procedures call db helpers that require a live MySQL connection,
 * we mock the db module so the tests run in isolation without a database.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrpcContext } from "./_core/context";

// ---------------------------------------------------------------------------
// Mock the db module before importing the router so the router picks up mocks
// ---------------------------------------------------------------------------
vi.mock("./db", () => ({
  getUserCountingCategories: vi.fn(),
  createCountingCategory: vi.fn(),
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("countingCategories.list", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the user's saved categories", async () => {
    const mockCategories = [
      { id: 1, userId: 42, name: "Vents", createdAt: new Date() },
      { id: 2, userId: 42, name: "Drains", createdAt: new Date() },
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

describe("countingCategories.create", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a new category and returns its id", async () => {
    vi.mocked(db.getUserCountingCategories).mockResolvedValue([]);
    vi.mocked(db.createCountingCategory).mockResolvedValue(99);

    const caller = appRouter.createCaller(makeCtx(42));
    const result = await caller.countingCategories.create({ name: "Skylights" });

    expect(db.createCountingCategory).toHaveBeenCalledWith({
      userId: 42,
      name: "Skylights",
    });
    expect(result).toEqual({ id: 99 });
  });

  it("trims whitespace from the category name before saving", async () => {
    vi.mocked(db.getUserCountingCategories).mockResolvedValue([]);
    vi.mocked(db.createCountingCategory).mockResolvedValue(100);

    const caller = appRouter.createCaller(makeCtx(42));
    await caller.countingCategories.create({ name: "  Flashings  " });

    expect(db.createCountingCategory).toHaveBeenCalledWith({
      userId: 42,
      name: "Flashings",
    });
  });

  it("returns the existing id without creating a duplicate (case-insensitive)", async () => {
    const existing = [{ id: 7, userId: 42, name: "Vents", createdAt: new Date() }];
    vi.mocked(db.getUserCountingCategories).mockResolvedValue(existing);

    const caller = appRouter.createCaller(makeCtx(42));
    const result = await caller.countingCategories.create({ name: "vents" });

    // Should NOT call createCountingCategory
    expect(db.createCountingCategory).not.toHaveBeenCalled();
    expect(result).toEqual({ id: 7 });
  });

  it("rejects an empty name with a validation error", async () => {
    const caller = appRouter.createCaller(makeCtx(42));
    await expect(
      caller.countingCategories.create({ name: "" })
    ).rejects.toThrow();
  });
});

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
