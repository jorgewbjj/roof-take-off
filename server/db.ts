import { eq, desc, and } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, users, projects, measurements, InsertProject, InsertMeasurement, countingCategories, InsertCountingCategory } from "../drizzle/schema";
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
