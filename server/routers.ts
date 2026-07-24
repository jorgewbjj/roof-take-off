import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";
import * as db from "./db";
import { storagePut, storageGet } from "./storage";
import { nanoid } from "nanoid";

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  projects: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const projects = await db.getUserProjects(ctx.user.id);
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

    get: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        const project = await db.getProjectById(input.id, ctx.user.id);
        if (!project || !project.pdfKey) return project;
        try {
          const { url } = await storageGet(project.pdfKey);
          return { ...project, pdfUrl: url };
        } catch {
          return project; // Fall back to stored URL on error
        }
      }),

    getPdfUrl: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        const project = await db.getProjectById(input.id, ctx.user.id);
        if (!project) throw new Error('Project not found');
        
        // Generate fresh presigned URL using storage proxy
        const { storageGet } = await import('./storage');
        const { url } = await storageGet(project.pdfKey);
        
        return { url };
      }),

    create: protectedProcedure
      .input(z.object({
        name: z.string().min(1),
        pdfFile: z.object({
          data: z.string(), // base64 encoded
          filename: z.string(),
          mimeType: z.string(),
        }),
      }))
      .mutation(async ({ ctx, input }) => {
        // Upload PDF to S3
        const buffer = Buffer.from(input.pdfFile.data, 'base64');
        const fileKey = `${ctx.user.id}/pdfs/${nanoid()}-${input.pdfFile.filename}`;
        const { url } = await storagePut(fileKey, buffer, input.pdfFile.mimeType);

        // Create project in database
        const projectId = await db.createProject({
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
        await db.updateProject(id, ctx.user.id, updates);
        return { success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await db.deleteProject(input.id, ctx.user.id);
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
      .mutation(async ({ input }) => {
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
        // Verify user owns the measurement's project before updating
        await db.updateMeasurementIfOwned(id, ctx.user.id, updates);
        return { success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
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
        // Verify ownership via project
        const project = await db.getProjectById(input.projectId, ctx.user.id);
        if (!project) throw new Error('Project not found or access denied');
        await db.deleteTextAnnotation(input.id, input.projectId);
        return { success: true };
      }),
  }),

  countingCategories: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      return db.getUserCountingCategories(ctx.user.id);
    }),

    create: protectedProcedure
      .input(z.object({
        name: z.string().min(1).max(255),
        measurementType: z.enum(['area', 'linear', 'count']).default('count'),
      }))
      .mutation(async ({ ctx, input }) => {
        // Prevent duplicate names for this user
        const existing = await db.getUserCountingCategories(ctx.user.id);
        const duplicate = existing.find(
          (c) => c.name.toLowerCase() === input.name.trim().toLowerCase()
        );
        if (duplicate) {
          // If the type changed, update it; otherwise return existing id
          if (duplicate.measurementType !== input.measurementType) {
            await db.updateCountingCategory(duplicate.id, ctx.user.id, {
              measurementType: input.measurementType,
            });
          }
          return { id: duplicate.id };
        }
        const categoryId = await db.createCountingCategory({
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
        await db.updateCountingCategory(id, ctx.user.id, updates);
        return { success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await db.deleteCountingCategory(input.id, ctx.user.id);
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
        const fileKey = `${ctx.user.id}/tabs/${nanoid()}-${input.pdfFile.filename}`;
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
        const { id, ...updates } = input;
        await db.updatePlanTab(id, ctx.user.id, updates);
        return { success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await db.deletePlanTab(input.id, ctx.user.id);
        return { success: true };
      }),
  }),
});

export type AppRouter = typeof appRouter;

