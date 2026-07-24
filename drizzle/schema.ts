import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, json, decimal, float } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Projects table - stores roof plan projects with PDF references
 */
export const projects = mysqlTable("projects", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  pdfUrl: text("pdfUrl").notNull(),
  pdfKey: text("pdfKey").notNull(),
  scale: decimal("scale", { precision: 10, scale: 4 }).default("1.0000"),
  scaleUnit: varchar("scaleUnit", { length: 20 }).default("ft"),
  notes: text("notes"),
  /** Custom name for the default (Plan 1) tab. Null = display as "Plan 1" */
  defaultTabName: varchar("defaultTabName", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Project = typeof projects.$inferSelect;
export type InsertProject = typeof projects.$inferInsert;

/**
 * Measurements table - stores area, line, and point measurements for each project
 * Types: 'area' (polygons), 'line' (linear measurements), 'point' (item counts)
 */
export const measurements = mysqlTable("measurements", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  /** Nullable: null = default/original project tab (backward compat); set for additional plan tabs */
  tabId: int("tabId"),
  name: varchar("name", { length: 255 }).notNull(),
  type: mysqlEnum("type", ["area", "line", "point"]).default("area").notNull(), // Measurement type
  color: varchar("color", { length: 7 }).notNull(), // Hex color code
  area: decimal("area", { precision: 12, scale: 2 }), // For area measurements (nullable)
  perimeter: decimal("perimeter", { precision: 12, scale: 2 }), // For line measurements or area perimeters
  count: int("count"), // For point measurements (number of items)
  coordinates: json("coordinates").notNull(), // Array of {x, y} points
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Measurement = typeof measurements.$inferSelect;
export type InsertMeasurement = typeof measurements.$inferInsert;

/**
 * Counting Categories table - stores custom counting categories created by users
 * Preset categories (Curbs, Pipes) are hardcoded in the frontend
 * This table stores user-created custom categories that persist across projects
 */
export const countingCategories = mysqlTable("countingCategories", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(), // Owner of this custom category
  name: varchar("name", { length: 255 }).notNull(), // Category name (e.g., "Vents", "Drains")
  /**
   * measurementType determines which drawing mode is activated when this category is selected:
   *   'area'   → polygon drawing (sq ft)
   *   'linear' → polyline drawing (linear ft)
   *   'count'  → point counting (item count)
   * Defaults to 'count' for backward compatibility with existing custom counting categories.
   */
  measurementType: mysqlEnum("measurementType", ["area", "linear", "count"]).default("count").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type CountingCategory = typeof countingCategories.$inferSelect;
export type InsertCountingCategory = typeof countingCategories.$inferInsert;

/**
 * Text Annotations table - stores draggable/resizable text boxes placed on the PDF plan
 * Coordinates are stored in baseScale pixel space (same as measurement coordinates)
 */
export const textAnnotations = mysqlTable("textAnnotations", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  /** Nullable: null = default/original project tab (backward compat); set for additional plan tabs */
  tabId: int("tabId"),
  pageNumber: int("pageNumber").default(1).notNull(),
  /** X position in baseScale pixel space (same coordinate system as measurements) */
  x: float("x").notNull(),
  /** Y position in baseScale pixel space */
  y: float("y").notNull(),
  /** Width in baseScale pixels */
  width: float("width").notNull().default(200),
  /** Height in baseScale pixels */
  height: float("height").notNull().default(80),
  /** The text content */
  content: varchar("content", { length: 2000 }).notNull().default("Text"),
  /** Font size in baseScale pixels (e.g. 24 = ~10pt at export scale) */
  fontSize: int("fontSize").notNull().default(24),
  /** Text color as hex */
  textColor: varchar("textColor", { length: 7 }).notNull().default("#000000"),
  /** Background color as hex, or 'transparent' */
  bgColor: varchar("bgColor", { length: 20 }).notNull().default("#ffffff"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type TextAnnotation = typeof textAnnotations.$inferSelect;
export type InsertTextAnnotation = typeof textAnnotations.$inferInsert;

/**
 * Plan Tabs table - each tab within a project holds a separate PDF plan
 * with its own measurements and text annotations.
 * tabId = null on measurements/annotations means the "default" tab
 * (the original project PDF, for backward compatibility).
 */
export const planTabs = mysqlTable("planTabs", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  name: varchar("name", { length: 255 }).notNull().default("Plan 1"),
  sortOrder: int("sortOrder").notNull().default(0),
  pdfUrl: text("pdfUrl").notNull(),
  pdfKey: text("pdfKey").notNull(),
  scale: decimal("scale", { precision: 10, scale: 4 }).default("1.0000"),
  scaleUnit: varchar("scaleUnit", { length: 20 }).default("ft"),
  currentPage: int("currentPage").default(1).notNull(),
  totalPages: int("totalPages").default(1).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type PlanTab = typeof planTabs.$inferSelect;
export type InsertPlanTab = typeof planTabs.$inferInsert;
