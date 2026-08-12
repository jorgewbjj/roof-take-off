import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

vi.mock("./db");
import * as db from "./db";
import { appRouter } from "./routers";

function makeContext(): TrpcContext {
  return {
    user: { id: 1, openId: "label-user", email: "label@example.com", name: "Label User", loginMethod: "credential", role: "user", isActive: true, isPlatformOwner: false, passwordHash: null, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() },
    activeOrganization: { membershipId: 1, organizationId: 1, organizationName: "Label Workspace", organizationSlug: "label-workspace", role: "owner" },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

const project = { id: 42, userId: 1, organizationId: 1, name: "Label Test", pdfUrl: null, pdfKey: null, scale: "1", scaleUnit: "ft", createdAt: new Date(), updatedAt: new Date() };

describe("callout labels", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.getProjectById).mockResolvedValue(project as never);
    vi.mocked(db.updateCallout).mockResolvedValue(undefined);
  });

  it("persists edited callout text", async () => {
    const result = await appRouter.createCaller(makeContext()).callouts.update({ id: 7, projectId: 42, text: "HVAC curb — verify flashing" });
    expect(result).toEqual({ success: true });
    expect(db.updateCallout).toHaveBeenCalledWith(7, 42, expect.objectContaining({ text: "HVAC curb — verify flashing" }));
  });

  it("persists free repositioning of both the bubble and leader anchor", async () => {
    const result = await appRouter.createCaller(makeContext()).callouts.update({ id: 7, projectId: 42, bubbleX: 360, bubbleY: 220, anchorX: 148, anchorY: 91 });
    expect(result).toEqual({ success: true });
    expect(db.updateCallout).toHaveBeenCalledWith(7, 42, expect.objectContaining({ bubbleX: 360, bubbleY: 220, anchorX: 148, anchorY: 91 }));
  });
});
