import { describe, expect, it } from "vitest";
import { hasActiveWorkspaceEntitlement } from "./entitlements";

describe("workspace subscription entitlements", () => {
  const now = new Date("2026-08-12T00:00:00.000Z");

  it("allows an active paid workspace", () => {
    expect(hasActiveWorkspaceEntitlement("active", null, now)).toBe(true);
  });

  it("allows an unexpired no-card trial", () => {
    expect(hasActiveWorkspaceEntitlement("trialing", new Date("2026-08-13T00:00:00.000Z"), now)).toBe(true);
  });

  it("blocks an expired trial and non-paying statuses", () => {
    expect(hasActiveWorkspaceEntitlement("trialing", new Date("2026-08-11T23:59:59.000Z"), now)).toBe(false);
    expect(hasActiveWorkspaceEntitlement("past_due", null, now)).toBe(false);
    expect(hasActiveWorkspaceEntitlement("canceled", null, now)).toBe(false);
  });
});
