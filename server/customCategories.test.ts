import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

vi.mock("./db", () => ({
  getOrganizationCountingCategories: vi.fn(),
  createCountingCategory: vi.fn(),
  updateCountingCategoryInOrganization: vi.fn(),
  deleteCountingCategoryInOrganization: vi.fn(),
}));

import * as db from "./db";
import { appRouter } from "./routers";

function makeCtx(): TrpcContext {
  return {
    user: { id: 42, openId: "test-user", email: "test@example.com", name: "Test User", loginMethod: "credential", role: "user", isActive: true, isPlatformOwner: false, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(), passwordHash: null },
    activeOrganization: { membershipId: 1, organizationId: 7, organizationName: "Acme Roofing", organizationSlug: "acme-roofing", role: "owner" },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

const category = { id: 3, organizationId: 7, userId: 42, name: "Drains", measurementType: "count" as const, createdAt: new Date() };

describe("organization-scoped counting categories", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists only categories from the active workspace", async () => {
    vi.mocked(db.getOrganizationCountingCategories).mockResolvedValue([category]);
    const result = await appRouter.createCaller(makeCtx()).countingCategories.list();
    expect(db.getOrganizationCountingCategories).toHaveBeenCalledWith(7);
    expect(result).toEqual([category]);
  });

  it("creates categories under the active workspace", async () => {
    vi.mocked(db.getOrganizationCountingCategories).mockResolvedValue([]);
    vi.mocked(db.createCountingCategory).mockResolvedValue(9);
    const result = await appRouter.createCaller(makeCtx()).countingCategories.create({ name: "Skylights", measurementType: "area" });
    expect(db.createCountingCategory).toHaveBeenCalledWith({ organizationId: 7, userId: 42, name: "Skylights", measurementType: "area" });
    expect(result).toEqual({ id: 9 });
  });

  it("updates a duplicate category type within the workspace instead of creating a duplicate", async () => {
    vi.mocked(db.getOrganizationCountingCategories).mockResolvedValue([category]);
    vi.mocked(db.updateCountingCategoryInOrganization).mockResolvedValue(undefined);
    const result = await appRouter.createCaller(makeCtx()).countingCategories.create({ name: "drains", measurementType: "linear" });
    expect(db.updateCountingCategoryInOrganization).toHaveBeenCalledWith(3, 7, { measurementType: "linear" });
    expect(result).toEqual({ id: 3 });
  });

  it("prevents viewer members from changing shared categories", async () => {
    const ctx = makeCtx();
    ctx.activeOrganization = { ...ctx.activeOrganization!, role: "viewer" };
    await expect(appRouter.createCaller(ctx).countingCategories.delete({ id: 3 })).rejects.toThrow("workspace role");
  });
});
