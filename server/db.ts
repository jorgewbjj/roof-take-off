import { eq, desc, and, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, users, projects, measurements, InsertProject, InsertMeasurement, countingCategories, InsertCountingCategory, textAnnotations, InsertTextAnnotation, planTabs, InsertPlanTab, cutouts, InsertCutout, dimensionLines, InsertDimensionLine, callouts, InsertCallout } from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

// Project queries
export async function getUserProjects(userId: number) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(projects).where(eq(projects.userId, userId)).orderBy(desc(projects.updatedAt));
}

export async function getProjectById(projectId: number, userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  
  const result = await db.select().from(projects).where(
    and(eq(projects.id, projectId), eq(projects.userId, userId))
  ).limit(1);
  
  return result.length > 0 ? result[0] : undefined;
}

export async function createProject(project: InsertProject) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(projects).values(project);
  return result[0].insertId;
}

export async function updateProject(projectId: number, userId: number, updates: Partial<InsertProject>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(projects).set(updates).where(
    and(eq(projects.id, projectId), eq(projects.userId, userId))
  );
}

export async function deleteProject(projectId: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // Delete all measurements first
  await db.delete(measurements).where(eq(measurements.projectId, projectId));
  
  // Delete the project
  await db.delete(projects).where(
    and(eq(projects.id, projectId), eq(projects.userId, userId))
  );
}

// Measurement queries
export async function getProjectMeasurements(projectId: number) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(measurements).where(eq(measurements.projectId, projectId)).orderBy(desc(measurements.createdAt));
}

export async function createMeasurement(measurement: InsertMeasurement) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(measurements).values(measurement);
  return result[0].insertId;
}

export async function updateMeasurement(measurementId: number, updates: Partial<InsertMeasurement>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(measurements).set(updates).where(eq(measurements.id, measurementId));
}

/** Update a measurement only if the requesting user owns the project it belongs to */
export async function updateMeasurementIfOwned(measurementId: number, userId: number, updates: Partial<InsertMeasurement>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Join with projects to verify ownership
  const result = await db.select({ projectUserId: projects.userId })
    .from(measurements)
    .innerJoin(projects, eq(measurements.projectId, projects.id))
    .where(eq(measurements.id, measurementId))
    .limit(1);

  if (!result.length || result[0].projectUserId !== userId) {
    throw new Error('Measurement not found or access denied');
  }

  await db.update(measurements).set(updates).where(eq(measurements.id, measurementId));
}

export async function deleteMeasurement(measurementId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.delete(measurements).where(eq(measurements.id, measurementId));
}

/** Delete a measurement only if the requesting user owns the project it belongs to */
export async function deleteMeasurementIfOwned(measurementId: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Join with projects to verify ownership
  const result = await db.select({ projectUserId: projects.userId })
    .from(measurements)
    .innerJoin(projects, eq(measurements.projectId, projects.id))
    .where(eq(measurements.id, measurementId))
    .limit(1);

  if (!result.length || result[0].projectUserId !== userId) {
    throw new Error('Measurement not found or access denied');
  }

  await db.delete(measurements).where(eq(measurements.id, measurementId));
}

// Counting Categories queries
export async function getUserCountingCategories(userId: number) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(countingCategories).where(eq(countingCategories.userId, userId)).orderBy(desc(countingCategories.createdAt));
}

export async function createCountingCategory(category: InsertCountingCategory) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(countingCategories).values(category);
  return result[0].insertId;
}

export async function updateCountingCategory(
  id: number,
  userId: number,
  updates: { name?: string; measurementType?: 'area' | 'linear' | 'count' }
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Only allow updates to categories owned by this user
  await db.update(countingCategories)
    .set(updates)
    .where(and(eq(countingCategories.id, id), eq(countingCategories.userId, userId)));
}

export async function deleteCountingCategory(id: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Only allow deletion of categories owned by this user
  await db.delete(countingCategories).where(
    and(eq(countingCategories.id, id), eq(countingCategories.userId, userId))
  );
}

// Text Annotation queries
export async function getProjectTextAnnotations(projectId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(textAnnotations)
    .where(eq(textAnnotations.projectId, projectId))
    .orderBy(textAnnotations.createdAt);
}

export async function createTextAnnotation(annotation: InsertTextAnnotation) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(textAnnotations).values(annotation);
  return result[0].insertId;
}

export async function updateTextAnnotation(
  id: number,
  projectId: number,
  updates: Partial<Pick<InsertTextAnnotation, 'x' | 'y' | 'width' | 'height' | 'content' | 'fontSize' | 'textColor' | 'bgColor'>>
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Verify the annotation belongs to the given project (ownership enforced at router level)
  await db.update(textAnnotations)
    .set(updates)
    .where(and(eq(textAnnotations.id, id), eq(textAnnotations.projectId, projectId)));
}

export async function deleteTextAnnotation(id: number, projectId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(textAnnotations)
    .where(and(eq(textAnnotations.id, id), eq(textAnnotations.projectId, projectId)));
}

// ─── Plan Tab queries ─────────────────────────────────────────────────────────

export async function getProjectPlanTabs(projectId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(planTabs)
    .where(eq(planTabs.projectId, projectId))
    .orderBy(planTabs.sortOrder, planTabs.createdAt);
}

export async function getPlanTabById(tabId: number, userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  // Join with projects to verify ownership
  const result = await db.select({ tab: planTabs })
    .from(planTabs)
    .innerJoin(projects, eq(planTabs.projectId, projects.id))
    .where(and(eq(planTabs.id, tabId), eq(projects.userId, userId)))
    .limit(1);
  return result.length > 0 ? result[0].tab : undefined;
}

export async function createPlanTab(tab: InsertPlanTab) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(planTabs).values(tab);
  return result[0].insertId;
}

export async function updatePlanTab(
  tabId: number,
  userId: number,
  updates: Partial<Pick<InsertPlanTab, 'name' | 'sortOrder' | 'pdfUrl' | 'pdfKey' | 'scale' | 'scaleUnit' | 'currentPage' | 'totalPages'>>
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Verify ownership via project join
  const tab = await getPlanTabById(tabId, userId);
  if (!tab) throw new Error('Plan tab not found or access denied');
  await db.update(planTabs).set(updates).where(eq(planTabs.id, tabId));
}

export async function deletePlanTab(tabId: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const tab = await getPlanTabById(tabId, userId);
  if (!tab) throw new Error('Plan tab not found or access denied');
  // Delete associated measurements and annotations first
  await db.delete(measurements).where(eq(measurements.tabId, tabId));
  await db.delete(textAnnotations).where(eq(textAnnotations.tabId, tabId));
  await db.delete(planTabs).where(eq(planTabs.id, tabId));
}

/** Get measurements for a specific tab (tabId=null means the default/original project tab) */
export async function getTabMeasurements(projectId: number, tabId: number | null) {
  const db = await getDb();
  if (!db) return [];
  if (tabId === null) {
    return db.select().from(measurements)
      .where(and(eq(measurements.projectId, projectId), isNull(measurements.tabId)))
      .orderBy(desc(measurements.createdAt));
  }
  return db.select().from(measurements)
    .where(and(eq(measurements.projectId, projectId), eq(measurements.tabId, tabId)))
    .orderBy(desc(measurements.createdAt));
}

/** Get text annotations for a specific tab */
export async function getTabTextAnnotations(projectId: number, tabId: number | null) {
  const db = await getDb();
  if (!db) return [];
  if (tabId === null) {
    return db.select().from(textAnnotations)
      .where(and(eq(textAnnotations.projectId, projectId), isNull(textAnnotations.tabId)))
      .orderBy(textAnnotations.createdAt);
  }
  return db.select().from(textAnnotations)
    .where(and(eq(textAnnotations.projectId, projectId), eq(textAnnotations.tabId, tabId)))
    .orderBy(textAnnotations.createdAt);
}

/** Get ALL measurements for a project across all tabs (for report generation) */
export async function getAllProjectMeasurements(projectId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(measurements)
    .where(eq(measurements.projectId, projectId))
    .orderBy(measurements.tabId, desc(measurements.createdAt));
}

// ─── Cutout queries ───────────────────────────────────────────────────────────

export async function getTabCutouts(projectId: number, tabId: number | null) {
  const db = await getDb();
  if (!db) return [];
  if (tabId === null) {
    return db.select().from(cutouts)
      .where(and(eq(cutouts.projectId, projectId), isNull(cutouts.tabId)))
      .orderBy(cutouts.createdAt);
  }
  return db.select().from(cutouts)
    .where(and(eq(cutouts.projectId, projectId), eq(cutouts.tabId, tabId)))
    .orderBy(cutouts.createdAt);
}

export async function createCutout(cutout: InsertCutout) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(cutouts).values(cutout);
  return result[0].insertId;
}

export async function deleteCutout(id: number, projectId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(cutouts).where(and(eq(cutouts.id, id), eq(cutouts.projectId, projectId)));
}

// ─── Dimension Line queries ───────────────────────────────────────────────────

export async function getTabDimensionLines(projectId: number, tabId: number | null) {
  const db = await getDb();
  if (!db) return [];
  if (tabId === null) {
    return db.select().from(dimensionLines)
      .where(and(eq(dimensionLines.projectId, projectId), isNull(dimensionLines.tabId)))
      .orderBy(dimensionLines.createdAt);
  }
  return db.select().from(dimensionLines)
    .where(and(eq(dimensionLines.projectId, projectId), eq(dimensionLines.tabId, tabId)))
    .orderBy(dimensionLines.createdAt);
}

export async function createDimensionLine(dim: InsertDimensionLine) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(dimensionLines).values(dim);
  return result[0].insertId;
}

export async function updateDimensionLine(
  id: number,
  projectId: number,
  updates: Partial<Pick<InsertDimensionLine, 'x1' | 'y1' | 'x2' | 'y2' | 'offsetPx' | 'customLabel' | 'color'>>
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(dimensionLines).set(updates).where(and(eq(dimensionLines.id, id), eq(dimensionLines.projectId, projectId)));
}

export async function deleteDimensionLine(id: number, projectId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(dimensionLines).where(and(eq(dimensionLines.id, id), eq(dimensionLines.projectId, projectId)));
}

// ─── Callout queries ──────────────────────────────────────────────────────────

export async function getTabCallouts(projectId: number, tabId: number | null) {
  const db = await getDb();
  if (!db) return [];
  if (tabId === null) {
    return db.select().from(callouts)
      .where(and(eq(callouts.projectId, projectId), isNull(callouts.tabId)))
      .orderBy(callouts.createdAt);
  }
  return db.select().from(callouts)
    .where(and(eq(callouts.projectId, projectId), eq(callouts.tabId, tabId)))
    .orderBy(callouts.createdAt);
}

export async function createCallout(callout: InsertCallout) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(callouts).values(callout);
  return result[0].insertId;
}

export async function updateCallout(
  id: number,
  projectId: number,
  updates: Partial<Pick<InsertCallout, 'anchorX' | 'anchorY' | 'bubbleX' | 'bubbleY' | 'bubbleW' | 'bubbleH' | 'text' | 'color' | 'textColor'>>
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(callouts).set(updates).where(and(eq(callouts.id, id), eq(callouts.projectId, projectId)));
}

export async function deleteCallout(id: number, projectId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(callouts).where(and(eq(callouts.id, id), eq(callouts.projectId, projectId)));
}
