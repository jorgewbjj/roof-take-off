import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { organizationAdminProcedure, organizationProcedure, organizationWriteProcedure, platformOwnerProcedure, publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as db from "./db";
import {
  clearCustomerSessionCookie,
  clearFailedLogins,
  createOrganizationSlug,
  createOpaqueToken,
  customerSessionExpiry,
  hashOpaqueToken,
  hashPassword,
  isLoginRateLimited,
  normalizeEmail,
  recordFailedLogin,
  readCustomerSessionToken,
  setCustomerSessionCookie,
  validatePassword,
  verifyPassword,
} from "./customerAuth";
import { createCustomerBillingPortal, createOrUpdateStripePlanCatalogEntry, createSubscriptionCheckout } from "./stripe";
import { storagePut, storageGet } from "./storage";
import { nanoid } from "nanoid";

function publicUser<T extends { passwordHash?: string | null }>(user: T) {
  const { passwordHash: _passwordHash, ...safeUser } = user;
  return safeUser;
}

async function createCustomerSession(userId: number, ctx: { req: Parameters<typeof setCustomerSessionCookie>[1]; res: Parameters<typeof setCustomerSessionCookie>[0] }) {
  const rawToken = createOpaqueToken();
  await db.createAuthSession(userId, hashOpaqueToken(rawToken), customerSessionExpiry());
  setCustomerSessionCookie(ctx.res, ctx.req, rawToken);
}

async function requireProjectInOrganization(projectId: number, organizationId: number) {
  const project = await db.getProjectByOrganizationId(projectId, organizationId);
  if (!project) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Project not found or access denied." });
  }
  return project;
}

type OrganizationContext = {
  activeOrganization: {
    organizationId: number;
    role: "owner" | "admin" | "estimator" | "viewer";
  } | null;
};

function requireActiveOrganization(ctx: OrganizationContext) {
  if (!ctx.activeOrganization) {
    throw new TRPCError({ code: "FORBIDDEN", message: "An active organization workspace is required." });
  }
  return ctx.activeOrganization;
}

function requireOrganizationWriteAccess(ctx: OrganizationContext) {
  const organization = requireActiveOrganization(ctx);
  if (organization.role === "viewer") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Your workspace role does not allow this action." });
  }
  return organization;
}

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user ? publicUser(opts.ctx.user) : null),
    signup: publicProcedure
      .input(z.object({
        name: z.string().trim().min(2).max(120),
        organizationName: z.string().trim().min(2).max(255),
        email: z.string().email().max(320),
        password: z.string().min(1).max(128),
      }))
      .mutation(async ({ ctx, input }) => {
        const passwordError = validatePassword(input.password);
        if (passwordError) throw new TRPCError({ code: "BAD_REQUEST", message: passwordError });
        const email = normalizeEmail(input.email);
        if (await db.getUserByEmail(email)) {
          throw new TRPCError({ code: "CONFLICT", message: "An account already exists for this email." });
        }
        const workspace = await db.createCustomerWorkspace({
          email,
          name: input.name.trim(),
          passwordHash: await hashPassword(input.password),
          organizationName: input.organizationName.trim(),
          organizationSlug: createOrganizationSlug(input.organizationName),
        });
        const user = await db.getUserByEmail(email);
        if (!user) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Account setup did not complete." });
        await createCustomerSession(user.id, ctx);
        return {
          user: publicUser(user),
          organizationId: workspace.organizationId,
          trialEndsAt: workspace.trialEndsAt,
        };
      }),
    login: publicProcedure
      .input(z.object({ email: z.string().email().max(320), password: z.string().min(1).max(128) }))
      .mutation(async ({ ctx, input }) => {
        const email = normalizeEmail(input.email);
        const genericError = new TRPCError({ code: "UNAUTHORIZED", message: "Invalid email or password." });
        if (isLoginRateLimited(ctx.req, email)) {
          throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many sign-in attempts. Please wait and try again." });
        }
        const user = await db.getUserByEmail(email);
        if (!user || !user.passwordHash || !user.isActive) {
          recordFailedLogin(ctx.req, email);
          throw genericError;
        }
        const isValid = await verifyPassword(input.password, user.passwordHash);
        if (!isValid) {
          recordFailedLogin(ctx.req, email);
          throw genericError;
        }
        clearFailedLogins(ctx.req, email);
        await db.markUserSignedIn(user.id);
        await createCustomerSession(user.id, ctx);
        return { user: publicUser(user) };
      }),
    setPassword: protectedProcedure
      .input(z.object({ newPassword: z.string().min(1).max(128), currentPassword: z.string().min(1).max(128).optional() }))
      .mutation(async ({ ctx, input }) => {
        const passwordError = validatePassword(input.newPassword);
        if (passwordError) throw new TRPCError({ code: "BAD_REQUEST", message: passwordError });
        if (ctx.user.passwordHash) {
          if (!input.currentPassword || !await verifyPassword(input.currentPassword, ctx.user.passwordHash)) {
            throw new TRPCError({ code: "UNAUTHORIZED", message: "Current password is incorrect." });
          }
        }
        await db.updateUserPassword(ctx.user.id, await hashPassword(input.newPassword));
        await db.revokeAllAuthSessionsForUser(ctx.user.id);
        await createCustomerSession(ctx.user.id, ctx);
        return { success: true } as const;
      }),
    logout: publicProcedure.mutation(async ({ ctx }) => {
      const customerToken = readCustomerSessionToken(ctx.req);
      if (customerToken) await db.revokeAuthSession(hashOpaqueToken(customerToken));
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      clearCustomerSessionCookie(ctx.res, ctx.req);
      return {
        success: true,
      } as const;
    }),
  }),

  billing: router({
    plans: publicProcedure.query(async () => {
      return db.listPublicSubscriptionPlans();
    }),
    subscription: organizationProcedure.query(async ({ ctx }) => {
      return db.getOrganizationSubscription(ctx.activeOrganization.organizationId);
    }),
    checkout: organizationAdminProcedure
      .input(z.object({ planId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const originHeader = ctx.req.headers.origin;
        const origin = typeof originHeader === "string" && /^https?:\/\//.test(originHeader)
          ? originHeader
          : `${ctx.req.protocol}://${ctx.req.get("host")}`;
        return createSubscriptionCheckout({
          origin,
          organizationId: ctx.activeOrganization.organizationId,
          planId: input.planId,
          userId: ctx.user.id,
          customerEmail: ctx.user.email,
          customerName: ctx.user.name,
        });
      }),
    portal: organizationAdminProcedure.mutation(async ({ ctx }) => {
      const originHeader = ctx.req.headers.origin;
      const origin = typeof originHeader === "string" && /^https?:\/\//.test(originHeader)
        ? originHeader
        : `${ctx.req.protocol}://${ctx.req.get("host")}`;
      return createCustomerBillingPortal(origin, ctx.activeOrganization.organizationId);
    }),
  }),

  platformAdmin: router({
    subscriptionPlans: platformOwnerProcedure.query(async () => {
      return db.listAllSubscriptionPlans();
    }),
    createSubscriptionPlan: platformOwnerProcedure
      .input(z.object({
        code: z.string().trim().min(2).max(80).regex(/^[a-z0-9-]+$/),
        name: z.string().trim().min(2).max(120),
        description: z.string().max(2000).nullable().optional(),
        priceCents: z.number().int().min(0),
        currency: z.string().length(3).default("usd"),
        billingInterval: z.enum(["month", "year"]).default("month"),
        trialDays: z.number().int().min(0).max(90).default(14),
        maxProjects: z.number().int().positive().nullable().optional(),
        maxSeats: z.number().int().positive().nullable().optional(),
      }))
      .mutation(async ({ input }) => {
        const stripeMapping = await createOrUpdateStripePlanCatalogEntry({
          name: input.name,
          description: input.description ?? null,
          priceCents: input.priceCents,
          currency: input.currency.toLowerCase(),
          billingInterval: input.billingInterval,
        });
        const id = await db.createSubscriptionPlan({
          code: input.code,
          name: input.name,
          description: input.description ?? null,
          isActive: true,
          isSystemPlan: false,
          priceCents: input.priceCents,
          currency: input.currency.toLowerCase(),
          billingInterval: input.billingInterval,
          trialDays: input.trialDays,
          maxProjects: input.maxProjects ?? null,
          maxSeats: input.maxSeats ?? null,
          stripeProductId: stripeMapping.stripeProductId,
          stripePriceId: stripeMapping.stripePriceId,
        });
        return { id };
      }),
    updateSubscriptionPlan: platformOwnerProcedure
      .input(z.object({
        id: z.number().int().positive(),
        name: z.string().trim().min(2).max(120).optional(),
        description: z.string().max(2000).nullable().optional(),
        priceCents: z.number().int().min(0).optional(),
        currency: z.string().length(3).optional(),
        billingInterval: z.enum(["month", "year"]).optional(),
        trialDays: z.number().int().min(0).max(90).optional(),
        maxProjects: z.number().int().positive().nullable().optional(),
        maxSeats: z.number().int().positive().nullable().optional(),
        isActive: z.boolean().optional(),
      }))
      .mutation(async ({ input }) => {
        const existing = await db.getSubscriptionPlanById(input.id);
        if (!existing || existing.isSystemPlan) {
          throw new TRPCError({ code: "NOT_FOUND", message: "That configurable subscription plan was not found." });
        }
        const next = {
          name: input.name ?? existing.name,
          description: input.description === undefined ? existing.description : input.description,
          priceCents: input.priceCents ?? existing.priceCents,
          currency: (input.currency ?? existing.currency).toLowerCase(),
          billingInterval: input.billingInterval ?? existing.billingInterval,
        };
        const priceChanged = next.priceCents !== existing.priceCents || next.currency !== existing.currency || next.billingInterval !== existing.billingInterval;
        const stripeMapping = priceChanged || input.name !== undefined || input.description !== undefined
          ? await createOrUpdateStripePlanCatalogEntry({ ...next, existingStripeProductId: existing.stripeProductId })
          : { stripeProductId: existing.stripeProductId, stripePriceId: existing.stripePriceId };
        await db.updateSubscriptionPlan(input.id, {
          ...input,
          currency: input.currency?.toLowerCase(),
          stripeProductId: stripeMapping.stripeProductId,
          stripePriceId: stripeMapping.stripePriceId,
        });
        return { success: true } as const;
      }),
    organizations: platformOwnerProcedure.query(async () => {
      return db.listPlatformOrganizations();
    }),
  }),

  organizations: router({
    listMine: protectedProcedure.query(async ({ ctx }) => {
      return db.listUserOrganizations(ctx.user.id);
    }),
    active: protectedProcedure.query(async ({ ctx }) => {
      return ctx.activeOrganization;
    }),
    members: organizationProcedure.query(async ({ ctx }) => {
      return db.listOrganizationMembers(ctx.activeOrganization.organizationId);
    }),
    invitations: organizationAdminProcedure.query(async ({ ctx }) => {
      return db.listOrganizationInvitations(ctx.activeOrganization.organizationId);
    }),
    invite: organizationAdminProcedure
      .input(z.object({ email: z.string().email(), role: z.enum(["admin", "estimator", "viewer"]).default("estimator") }))
      .mutation(async ({ ctx, input }) => {
        const organizationId = ctx.activeOrganization.organizationId;
        const [members, subscription, usage] = await Promise.all([
          db.listOrganizationMembers(organizationId),
          db.getOrganizationSubscription(organizationId),
          db.getOrganizationUsage(organizationId),
        ]);
        const email = normalizeEmail(input.email);
        if (members.some(member => member.email?.toLowerCase() === email)) {
          throw new TRPCError({ code: "CONFLICT", message: "This person is already a member of the workspace." });
        }
        if (subscription?.plan.maxSeats !== null && subscription?.plan.maxSeats !== undefined && usage.seatCount >= subscription.plan.maxSeats) {
          throw new TRPCError({ code: "FORBIDDEN", message: `Your ${subscription.plan.name} plan allows up to ${subscription.plan.maxSeats} seats. Upgrade to invite another teammate.` });
        }
        await db.createOrganizationInvitation({
          organizationId,
          email,
          role: input.role,
          tokenHash: hashOpaqueToken(createOpaqueToken()),
          invitedByUserId: ctx.user.id,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        });
        return { success: true, deliveryPending: true };
      }),
    updateMemberRole: organizationAdminProcedure
      .input(z.object({ membershipId: z.number().int().positive(), role: z.enum(["admin", "estimator", "viewer"]) }))
      .mutation(async ({ ctx, input }) => {
        const member = (await db.listOrganizationMembers(ctx.activeOrganization.organizationId)).find(item => item.membershipId === input.membershipId);
        if (!member) throw new TRPCError({ code: "NOT_FOUND", message: "Workspace member not found." });
        if (member.role === "owner") throw new TRPCError({ code: "FORBIDDEN", message: "The workspace owner role cannot be changed." });
        await db.updateOrganizationMemberRole(ctx.activeOrganization.organizationId, input.membershipId, input.role);
        return { success: true };
      }),
    removeMember: organizationAdminProcedure
      .input(z.object({ membershipId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const member = (await db.listOrganizationMembers(ctx.activeOrganization.organizationId)).find(item => item.membershipId === input.membershipId);
        if (!member) throw new TRPCError({ code: "NOT_FOUND", message: "Workspace member not found." });
        if (member.role === "owner") throw new TRPCError({ code: "FORBIDDEN", message: "The workspace owner cannot be removed." });
        await db.removeOrganizationMember(ctx.activeOrganization.organizationId, input.membershipId);
        return { success: true };
      }),
  }),

  projects: router({
    list: organizationProcedure.query(async ({ ctx }) => {
      const projects = await db.getOrganizationProjects(ctx.activeOrganization.organizationId);
      // Generate fresh presigned URLs in parallel (stored URLs expire)
      const projectsWithFreshUrls = await Promise.all(
        projects.map(async (project) => {
          if (!project.pdfKey) return project;
          try {
            const { url } = await storageGet(project.pdfKey);
            return { ...project, pdfUrl: url };
          } catch {
            return project; // Fall back to stored URL on error
          }
        })
      );
      return projectsWithFreshUrls;
    }),

    get: organizationProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        const project = await db.getProjectByOrganizationId(input.id, ctx.activeOrganization.organizationId);
        if (!project || !project.pdfKey) return project;
        try {
          const { url } = await storageGet(project.pdfKey);
          return { ...project, pdfUrl: url };
        } catch {
          return project; // Fall back to stored URL on error
        }
      }),

    getPdfUrl: organizationProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        const project = await requireProjectInOrganization(input.id, ctx.activeOrganization.organizationId);
        
        // Generate fresh presigned URL using storage proxy
        const { storageGet } = await import('./storage');
        const { url } = await storageGet(project.pdfKey);
        
        return { url };
      }),

    create: organizationWriteProcedure
      .input(z.object({
        name: z.string().min(1),
        pdfFile: z.object({
          data: z.string(), // base64 encoded
          filename: z.string(),
          mimeType: z.string(),
        }),
      }))
      .mutation(async ({ ctx, input }) => {
        const organization = requireOrganizationWriteAccess(ctx);
        if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in is required." });
        const subscription = await db.getOrganizationSubscription(organization.organizationId);
        const usage = await db.getOrganizationUsage(organization.organizationId);
        if (subscription?.plan.maxProjects !== null && subscription?.plan.maxProjects !== undefined && usage.projectCount >= subscription.plan.maxProjects) {
          throw new TRPCError({ code: "FORBIDDEN", message: `Your ${subscription.plan.name} plan allows up to ${subscription.plan.maxProjects} projects. Upgrade to add another project.` });
        }
        // Upload PDF to S3
        const buffer = Buffer.from(input.pdfFile.data, 'base64');
        const fileKey = `organizations/${organization.organizationId}/pdfs/${nanoid()}-${input.pdfFile.filename}`;
        const { url } = await storagePut(fileKey, buffer, input.pdfFile.mimeType);

        // Create project in database
        const projectId = await db.createProject({
          organizationId: organization.organizationId,
          userId: ctx.user.id,
          name: input.name,
          pdfUrl: url,
          pdfKey: fileKey,
        });

        return { id: projectId, url };
      }),

    update: protectedProcedure
      .input(z.object({
        id: z.number(),
        name: z.string().min(1).optional(),
        scale: z.string().optional(),
        scaleUnit: z.string().optional(),
        notes: z.string().optional(),
        defaultTabName: z.string().min(1).max(255).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { id, ...updates } = input;
        const organization = requireOrganizationWriteAccess(ctx);
        await db.updateProjectInOrganization(id, organization.organizationId, updates);
        return { success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const organization = requireOrganizationWriteAccess(ctx);
        await db.deleteProjectInOrganization(input.id, organization.organizationId);
        return { success: true };
      }),
  }),

  measurements: router({
    list: protectedProcedure
      .input(z.object({
        projectId: z.number(),
        tabId: z.number().nullable().optional(), // null = default tab, undefined = all (legacy)
      }))
      .query(async ({ ctx, input }) => {
        // Verify user owns this project before returning measurements
        const project = await db.getProjectById(input.projectId, ctx.user.id);
        if (!project) throw new Error('Project not found or access denied');
        // If tabId is explicitly provided (including null), filter by tab
        if (input.tabId !== undefined) {
          return db.getTabMeasurements(input.projectId, input.tabId);
        }
        return db.getProjectMeasurements(input.projectId);
      }),

    listAll: protectedProcedure
      .input(z.object({ projectId: z.number() }))
      .query(async ({ ctx, input }) => {
        const project = await db.getProjectById(input.projectId, ctx.user.id);
        if (!project) throw new Error('Project not found or access denied');
        return db.getAllProjectMeasurements(input.projectId);
      }),

    create: protectedProcedure
      .input(z.object({
        projectId: z.number(),
        tabId: z.number().nullable().optional(),
        name: z.string().min(1),
        type: z.enum(['area', 'line', 'point']).optional(),
        color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
        area: z.string().optional(),
        perimeter: z.string().optional(),
        count: z.number().optional(),
        coordinates: z.array(z.object({ x: z.number(), y: z.number() })),
      }))
      .mutation(async ({ ctx, input }) => {
        await requireProjectInOrganization(input.projectId, requireOrganizationWriteAccess(ctx).organizationId);
        const measurementId = await db.createMeasurement(input);
        return { id: measurementId };
      }),

    update: protectedProcedure
      .input(z.object({
        id: z.number(),
        name: z.string().min(1).optional(),
        color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
        area: z.string().optional(),
        coordinates: z.array(z.object({ x: z.number(), y: z.number() })).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { id, ...updates } = input;
        requireOrganizationWriteAccess(ctx);
        // Verify user owns the measurement's project before updating
        await db.updateMeasurementIfOwned(id, ctx.user.id, updates);
        return { success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        requireOrganizationWriteAccess(ctx);
        // Verify user owns the measurement's project before deleting
        await db.deleteMeasurementIfOwned(input.id, ctx.user.id);
        return { success: true };
      }),
  }),

  textAnnotations: router({
    list: protectedProcedure
      .input(z.object({
        projectId: z.number(),
        tabId: z.number().nullable().optional(),
      }))
      .query(async ({ ctx, input }) => {
        // Verify user owns this project before returning annotations
        const project = await db.getProjectById(input.projectId, ctx.user.id);
        if (!project) throw new Error('Project not found or access denied');
        if (input.tabId !== undefined) {
          return db.getTabTextAnnotations(input.projectId, input.tabId);
        }
        return db.getProjectTextAnnotations(input.projectId);
      }),

    create: protectedProcedure
      .input(z.object({
        projectId: z.number(),
        tabId: z.number().nullable().optional(),
        pageNumber: z.number().default(1),
        x: z.number(),
        y: z.number(),
        width: z.number().default(200),
        height: z.number().default(80),
        content: z.string().max(2000).default('Text'),
        fontSize: z.number().min(8).max(200).default(24),
        textColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default('#000000'),
        bgColor: z.string().default('#ffffff'),
      }))
      .mutation(async ({ ctx, input }) => {
        requireOrganizationWriteAccess(ctx);
        // Verify ownership
        const project = await db.getProjectById(input.projectId, ctx.user.id);
        if (!project) throw new Error('Project not found or access denied');
        const id = await db.createTextAnnotation(input);
        return { id };
      }),

    update: protectedProcedure
      .input(z.object({
        id: z.number(),
        projectId: z.number(),
        x: z.number().optional(),
        y: z.number().optional(),
        width: z.number().optional(),
        height: z.number().optional(),
        content: z.string().max(2000).optional(),
        fontSize: z.number().min(8).max(200).optional(),
        textColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
        bgColor: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        requireOrganizationWriteAccess(ctx);
        // Verify ownership via project
        const project = await db.getProjectById(input.projectId, ctx.user.id);
        if (!project) throw new Error('Project not found or access denied');
        const { id, projectId, ...updates } = input;
        await db.updateTextAnnotation(id, projectId, updates);
        return { success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number(), projectId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        requireOrganizationWriteAccess(ctx);
        // Verify ownership via project
        const project = await db.getProjectById(input.projectId, ctx.user.id);
        if (!project) throw new Error('Project not found or access denied');
        await db.deleteTextAnnotation(input.id, input.projectId);
        return { success: true };
      }),
  }),

  countingCategories: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      return db.getOrganizationCountingCategories(requireActiveOrganization(ctx).organizationId);
    }),

    create: protectedProcedure
      .input(z.object({
        name: z.string().min(1).max(255),
        measurementType: z.enum(['area', 'linear', 'count']).default('count'),
      }))
      .mutation(async ({ ctx, input }) => {
        const organization = requireOrganizationWriteAccess(ctx);
        // Prevent duplicate names in the active shared workspace.
        const existing = await db.getOrganizationCountingCategories(organization.organizationId);
        const duplicate = existing.find(
          (c) => c.name.toLowerCase() === input.name.trim().toLowerCase()
        );
        if (duplicate) {
          // If the type changed, update it; otherwise return existing id
          if (duplicate.measurementType !== input.measurementType) {
            await db.updateCountingCategoryInOrganization(duplicate.id, organization.organizationId, {
              measurementType: input.measurementType,
            });
          }
          return { id: duplicate.id };
        }
        const categoryId = await db.createCountingCategory({
          organizationId: organization.organizationId,
          userId: ctx.user.id,
          name: input.name.trim(),
          measurementType: input.measurementType,
        });
        return { id: categoryId };
      }),

    update: protectedProcedure
      .input(z.object({
        id: z.number(),
        name: z.string().min(1).max(255).optional(),
        measurementType: z.enum(['area', 'linear', 'count']).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { id, ...updates } = input;
        const organization = requireOrganizationWriteAccess(ctx);
        await db.updateCountingCategoryInOrganization(id, organization.organizationId, updates);
        return { success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const organization = requireOrganizationWriteAccess(ctx);
        await db.deleteCountingCategoryInOrganization(input.id, organization.organizationId);
        return { success: true };
      }),
  }),

  planTabs: router({
    list: protectedProcedure
      .input(z.object({ projectId: z.number() }))
      .query(async ({ ctx, input }) => {
        const project = await db.getProjectById(input.projectId, ctx.user.id);
        if (!project) throw new Error('Project not found or access denied');
        const tabs = await db.getProjectPlanTabs(input.projectId);
        // Refresh presigned URLs for all tabs
        const tabsWithUrls = await Promise.all(
          tabs.map(async (tab) => {
            if (!tab.pdfKey) return tab;
            try {
              const { url } = await storageGet(tab.pdfKey);
              return { ...tab, pdfUrl: url };
            } catch {
              return tab;
            }
          })
        );
        return tabsWithUrls;
      }),

    create: protectedProcedure
      .input(z.object({
        projectId: z.number(),
        name: z.string().min(1).max(255),
        pdfFile: z.object({
          data: z.string(), // base64
          filename: z.string(),
          mimeType: z.string(),
        }),
        sortOrder: z.number().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const project = await db.getProjectById(input.projectId, ctx.user.id);
        if (!project) throw new Error('Project not found or access denied');
        const buffer = Buffer.from(input.pdfFile.data, 'base64');
        const organization = requireOrganizationWriteAccess(ctx);
        const fileKey = `organizations/${organization.organizationId}/tabs/${nanoid()}-${input.pdfFile.filename}`;
        const { url } = await storagePut(fileKey, buffer, input.pdfFile.mimeType);
        const tabId = await db.createPlanTab({
          projectId: input.projectId,
          name: input.name,
          pdfUrl: url,
          pdfKey: fileKey,
          sortOrder: input.sortOrder ?? 0,
          scale: project.scale ?? '1.0000',
          scaleUnit: project.scaleUnit ?? 'ft',
        });
        return { id: tabId, url };
      }),

    rename: protectedProcedure
      .input(z.object({ id: z.number(), name: z.string().min(1).max(255) }))
      .mutation(async ({ ctx, input }) => {
        requireOrganizationWriteAccess(ctx);
        await db.updatePlanTab(input.id, ctx.user.id, { name: input.name });
        return { success: true };
      }),

    updateState: protectedProcedure
      .input(z.object({
        id: z.number(),
        scale: z.string().optional(),
        scaleUnit: z.string().optional(),
        currentPage: z.number().optional(),
        totalPages: z.number().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        requireOrganizationWriteAccess(ctx);
        const { id, ...updates } = input;
        await db.updatePlanTab(id, ctx.user.id, updates);
        return { success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        requireOrganizationWriteAccess(ctx);
        await db.deletePlanTab(input.id, ctx.user.id);
        return { success: true };
      }),
  }),

  cutouts: router({
    list: protectedProcedure
      .input(z.object({ projectId: z.number(), tabId: z.number().nullable() }))
      .query(async ({ ctx, input }) => {
        const project = await db.getProjectById(input.projectId, ctx.user.id);
        if (!project) throw new Error('Project not found or access denied');
        return db.getTabCutouts(input.projectId, input.tabId);
      }),
    create: protectedProcedure
      .input(z.object({
        projectId: z.number(),
        tabId: z.number().nullable().optional(),
        parentMeasurementId: z.number(),
        name: z.string().min(1).max(255).optional(),
        area: z.string(),
        coordinates: z.array(z.object({ x: z.number(), y: z.number() })),
      }))
      .mutation(async ({ ctx, input }) => {
        const project = await db.getProjectById(input.projectId, ctx.user.id);
        if (!project) throw new Error('Project not found or access denied');
        requireOrganizationWriteAccess(ctx);
        const id = await db.createCutout({
          projectId: input.projectId,
          tabId: input.tabId ?? null,
          parentMeasurementId: input.parentMeasurementId,
          name: input.name ?? 'Cutout',
          area: input.area,
          coordinates: input.coordinates,
        });
        return { id };
      }),
    delete: protectedProcedure
      .input(z.object({ id: z.number(), projectId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const project = await db.getProjectById(input.projectId, ctx.user.id);
        if (!project) throw new Error('Project not found or access denied');
        requireOrganizationWriteAccess(ctx);
        await db.deleteCutout(input.id, input.projectId);
        return { success: true };
      }),
  }),

  dimensionLines: router({
    list: protectedProcedure
      .input(z.object({ projectId: z.number(), tabId: z.number().nullable() }))
      .query(async ({ ctx, input }) => {
        const project = await db.getProjectById(input.projectId, ctx.user.id);
        if (!project) throw new Error('Project not found or access denied');
        return db.getTabDimensionLines(input.projectId, input.tabId);
      }),
    create: protectedProcedure
      .input(z.object({
        projectId: z.number(),
        tabId: z.number().nullable().optional(),
        x1: z.number(), y1: z.number(),
        x2: z.number(), y2: z.number(),
        offsetPx: z.number().optional(),
        customLabel: z.string().max(100).optional(),
        color: z.string().max(7).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const project = await db.getProjectById(input.projectId, ctx.user.id);
        if (!project) throw new Error('Project not found or access denied');
        requireOrganizationWriteAccess(ctx);
        const id = await db.createDimensionLine({
          projectId: input.projectId,
          tabId: input.tabId ?? null,
          x1: input.x1, y1: input.y1,
          x2: input.x2, y2: input.y2,
          offsetPx: input.offsetPx ?? 40,
          customLabel: input.customLabel ?? null,
          color: input.color ?? '#1e40af',
        });
        return { id };
      }),
    update: protectedProcedure
      .input(z.object({
        id: z.number(), projectId: z.number(),
        offsetPx: z.number().optional(),
        customLabel: z.string().max(100).nullable().optional(),
        color: z.string().max(7).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const project = await db.getProjectById(input.projectId, ctx.user.id);
        if (!project) throw new Error('Project not found or access denied');
        const { id, projectId, ...updates } = input;
        await db.updateDimensionLine(id, projectId, updates);
        return { success: true };
      }),
    delete: protectedProcedure
      .input(z.object({ id: z.number(), projectId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const project = await db.getProjectById(input.projectId, ctx.user.id);
        if (!project) throw new Error('Project not found or access denied');
        await db.deleteDimensionLine(input.id, input.projectId);
        return { success: true };
      }),
  }),

  callouts: router({
    list: protectedProcedure
      .input(z.object({ projectId: z.number(), tabId: z.number().nullable() }))
      .query(async ({ ctx, input }) => {
        const project = await db.getProjectById(input.projectId, ctx.user.id);
        if (!project) throw new Error('Project not found or access denied');
        return db.getTabCallouts(input.projectId, input.tabId);
      }),
    create: protectedProcedure
      .input(z.object({
        projectId: z.number(),
        tabId: z.number().nullable().optional(),
        anchorX: z.number(), anchorY: z.number(),
        bubbleX: z.number(), bubbleY: z.number(),
        bubbleW: z.number().optional(), bubbleH: z.number().optional(),
        text: z.string().max(500).optional(),
        color: z.string().max(7).optional(),
        textColor: z.string().max(7).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const project = await db.getProjectById(input.projectId, ctx.user.id);
        if (!project) throw new Error('Project not found or access denied');
        requireOrganizationWriteAccess(ctx);
        const id = await db.createCallout({
          projectId: input.projectId,
          tabId: input.tabId ?? null,
          anchorX: input.anchorX, anchorY: input.anchorY,
          bubbleX: input.bubbleX, bubbleY: input.bubbleY,
          bubbleW: input.bubbleW ?? 160, bubbleH: input.bubbleH ?? 60,
          text: input.text ?? 'Label',
          color: input.color ?? '#fef9c3',
          textColor: input.textColor ?? '#1e293b',
        });
        return { id };
      }),
    update: protectedProcedure
      .input(z.object({
        id: z.number(), projectId: z.number(),
        anchorX: z.number().optional(), anchorY: z.number().optional(),
        bubbleX: z.number().optional(), bubbleY: z.number().optional(),
        bubbleW: z.number().optional(), bubbleH: z.number().optional(),
        text: z.string().max(500).optional(),
        color: z.string().max(7).optional(),
        textColor: z.string().max(7).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const project = await db.getProjectById(input.projectId, ctx.user.id);
        if (!project) throw new Error('Project not found or access denied');
        const { id, projectId, ...updates } = input;
        await db.updateCallout(id, projectId, updates);
        return { success: true };
      }),
    delete: protectedProcedure
      .input(z.object({ id: z.number(), projectId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const project = await db.getProjectById(input.projectId, ctx.user.id);
        if (!project) throw new Error('Project not found or access denied');
        await db.deleteCallout(input.id, input.projectId);
        return { success: true };
      }),
  }),
});

export type AppRouter = typeof appRouter;
