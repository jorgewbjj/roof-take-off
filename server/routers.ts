import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";
import * as db from "./db";
import { storagePut } from "./storage";
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
      return db.getUserProjects(ctx.user.id);
    }),

    get: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        return db.getProjectById(input.id, ctx.user.id);
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
      .input(z.object({ projectId: z.number() }))
      .query(async ({ ctx, input }) => {
        // Verify user owns this project before returning measurements
        const project = await db.getProjectById(input.projectId, ctx.user.id);
        if (!project) throw new Error('Project not found or access denied');
        return db.getProjectMeasurements(input.projectId);
      }),

    create: protectedProcedure
      .input(z.object({
        projectId: z.number(),
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
});

export type AppRouter = typeof appRouter;
