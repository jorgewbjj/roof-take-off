import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

vi.mock("./db", () => ({
  listOrganizationMembers: vi.fn(),
  getOrganizationSubscription: vi.fn(),
  getOrganizationUsage: vi.fn(),
  createOrganizationInvitation: vi.fn(),
}));

import * as db from "./db";
import { appRouter } from "./routers";

function makeContext(role: "owner" | "admin" | "estimator" | "viewer" = "owner"): TrpcContext {
  return {
    user: { id: 1, openId: "owner", email: "owner@example.com", name: "Owner", loginMethod: "credential", role: "user", isActive: true, isPlatformOwner: false, passwordHash: null, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() },
    activeOrganization: { membershipId: 1, organizationId: 9, organizationName: "Acme", organizationSlug: "acme", role },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

describe("organization team administration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.listOrganizationMembers).mockResolvedValue([]);
    vi.mocked(db.getOrganizationSubscription).mockResolvedValue({ subscription: { status: "trialing" }, plan: { name: "Pro", maxSeats: 3 } } as never);
    vi.mocked(db.getOrganizationUsage).mockResolvedValue({ projectCount: 0, seatCount: 1 });
    vi.mocked(db.createOrganizationInvitation).mockResolvedValue(5);
  });

  it("creates a token-hashed invitation record for an admin workspace member", async () => {
    const result = await appRouter.createCaller(makeContext("admin")).organizations.invite({ email: "estimator@example.com", role: "estimator" });
    expect(result).toEqual({ success: true, deliveryPending: true });
    expect(db.createOrganizationInvitation).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 9, email: "estimator@example.com", role: "estimator", invitedByUserId: 1, tokenHash: expect.any(String) }));
  });

  it("enforces the subscription seat cap before preparing an invitation", async () => {
    vi.mocked(db.getOrganizationUsage).mockResolvedValue({ projectCount: 0, seatCount: 3 });
    await expect(appRouter.createCaller(makeContext()).organizations.invite({ email: "another@example.com", role: "viewer" })).rejects.toThrow("allows up to 3 seats");
  });

  it("prevents viewers from preparing invitations", async () => {
    await expect(appRouter.createCaller(makeContext("viewer")).organizations.invite({ email: "another@example.com", role: "viewer" })).rejects.toThrow("workspace role");
  });
});
