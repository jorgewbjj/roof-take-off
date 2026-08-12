import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import * as db from "../db";
import { hasActiveWorkspaceEntitlement } from "../entitlements";
import type { TrpcContext } from "./context";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = t.procedure.use(requireUser);

const requireActiveOrganization = t.middleware(async opts => {
  const { ctx, next } = opts;
  if (!ctx.user || !ctx.activeOrganization) {
    throw new TRPCError({ code: "FORBIDDEN", message: "An active organization workspace is required." });
  }
  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
      activeOrganization: ctx.activeOrganization,
    },
  });
});

export const organizationProcedure = protectedProcedure.use(requireActiveOrganization);

function requireOrganizationRole(roles: Array<"owner" | "admin" | "estimator" | "viewer">) {
  return t.middleware(async opts => {
    const { ctx, next } = opts;
    if (!ctx.user || !ctx.activeOrganization || !roles.includes(ctx.activeOrganization.role)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Your workspace role does not allow this action." });
    }
    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
        activeOrganization: ctx.activeOrganization,
      },
    });
  });
}

const requireActiveEntitlement = t.middleware(async opts => {
  const { ctx, next } = opts;
  if (!ctx.activeOrganization) {
    throw new TRPCError({ code: "FORBIDDEN", message: "An active organization workspace is required." });
  }
  const record = await db.getOrganizationSubscription(ctx.activeOrganization.organizationId);
  if (!hasActiveWorkspaceEntitlement(record?.subscription.status, record?.subscription.trialEndsAt)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Your trial has ended or billing requires attention. Choose a subscription plan to continue editing." });
  }
  return next({ ctx });
});

/** Owners, admins, and estimators can create or edit takeoff data. */
export const organizationWriteProcedure = organizationProcedure.use(
  requireOrganizationRole(["owner", "admin", "estimator"]),
).use(requireActiveEntitlement);

/** Organization configuration, members, and billing are owner/admin only. */
export const organizationAdminProcedure = organizationProcedure.use(
  requireOrganizationRole(["owner", "admin"]),
);

/** Platform owner only: manages the SaaS catalog and customer organizations. */
export const platformOwnerProcedure = protectedProcedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;
    if (!ctx.user?.isPlatformOwner) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Platform owner access is required." });
    }
    return next({ ctx: { ...ctx, user: ctx.user } });
  }),
);

export const adminProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== 'admin') {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
);
