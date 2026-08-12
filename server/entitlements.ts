export type EntitlementStatus = "trialing" | "active" | "past_due" | "canceled" | "unpaid" | "incomplete" | "paused";

export function hasActiveWorkspaceEntitlement(
  status: EntitlementStatus | undefined,
  trialEndsAt: Date | null | undefined,
  now = new Date(),
) {
  return status === "active" || (status === "trialing" && !!trialEndsAt && trialEndsAt > now);
}
