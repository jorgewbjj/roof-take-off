import { eq, desc, and, gt, isNull, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, users, projects, measurements, InsertProject, InsertMeasurement, countingCategories, InsertCountingCategory, textAnnotations, InsertTextAnnotation, planTabs, InsertPlanTab, cutouts, InsertCutout, dimensionLines, InsertDimensionLine, callouts, InsertCallout } from "../drizzle/schema";
import { authSessions, billingWebhookEvents, organizationInvitations, organizationMembers, organizations, organizationSubscriptions, passwordResetTokens, subscriptionPlans } from "../drizzle/saas-schema";
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

/** Case-normalized customer lookup used by credential auth. */
export async function getUserByEmail(email: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

/** Create a customer account. Password hashes are prepared by the auth service, never in a router. */
export async function createCustomerUser(input: {
  email: string;
  name: string;
  passwordHash: string;
  mustChangePassword?: boolean;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(users).values({
    email: input.email,
    name: input.name,
    passwordHash: input.passwordHash,
    mustChangePassword: input.mustChangePassword ?? false,
    isActive: true,
    loginMethod: "password",
    lastSignedIn: new Date(),
  });
  return result[0].insertId;
}

/**
 * Creates the complete self-serve customer workspace atomically. If any insert fails,
 * no partial user, organization, membership, or trial subscription remains.
 */
export async function createCustomerWorkspace(input: {
  email: string;
  name: string;
  passwordHash: string;
  organizationName: string;
  organizationSlug: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.transaction(async tx => {
    const trialPlans = await tx.select().from(subscriptionPlans)
      .where(and(eq(subscriptionPlans.code, "trial"), eq(subscriptionPlans.isActive, true)))
      .limit(1);
    if (!trialPlans.length) throw new Error("The default trial plan is not configured");

    const userResult = await tx.insert(users).values({
      email: input.email,
      name: input.name,
      passwordHash: input.passwordHash,
      isActive: true,
      loginMethod: "password",
      lastSignedIn: new Date(),
    });
    const userId = Number(userResult[0].insertId);
    const organizationResult = await tx.insert(organizations).values({
      name: input.organizationName,
      slug: input.organizationSlug,
      status: "active",
    });
    const organizationId = Number(organizationResult[0].insertId);
    await tx.insert(organizationMembers).values({ organizationId, userId, role: "owner" });
    const trialEndsAt = new Date(Date.now() + trialPlans[0].trialDays * 24 * 60 * 60 * 1000);
    await tx.insert(organizationSubscriptions).values({
      organizationId,
      planId: trialPlans[0].id,
      status: "trialing",
      provider: "stripe",
      trialEndsAt,
      currentPeriodStart: new Date(),
    });
    return { userId, organizationId, trialEndsAt };
  });
}

export async function updateUserPassword(userId: number, passwordHash: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(users).set({ passwordHash, mustChangePassword: false, loginMethod: "password", updatedAt: new Date() })
    .where(eq(users.id, userId));
}

export async function markUserSignedIn(userId: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set({ lastSignedIn: new Date() }).where(eq(users.id, userId));
}

export async function createAuthSession(userId: number, tokenHash: string, expiresAt: Date) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(authSessions).values({ userId, tokenHash, expiresAt });
  return result[0].insertId;
}

/** Resolve only active, unexpired credential sessions and their active user. */
export async function getAuthSessionUser(tokenHash: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select({ sessionId: authSessions.id, user: users })
    .from(authSessions)
    .innerJoin(users, eq(authSessions.userId, users.id))
    .where(and(
      eq(authSessions.tokenHash, tokenHash),
      isNull(authSessions.revokedAt),
      gt(authSessions.expiresAt, new Date()),
      eq(users.isActive, true),
    ))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function touchAuthSession(sessionId: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(authSessions).set({ lastUsedAt: new Date() }).where(eq(authSessions.id, sessionId));
}

export async function revokeAuthSession(tokenHash: string) {
  const db = await getDb();
  if (!db) return;
  await db.update(authSessions).set({ revokedAt: new Date() })
    .where(and(eq(authSessions.tokenHash, tokenHash), isNull(authSessions.revokedAt)));
}

export async function revokeAllAuthSessionsForUser(userId: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(authSessions).set({ revokedAt: new Date() })
    .where(and(eq(authSessions.userId, userId), isNull(authSessions.revokedAt)));
}

export async function createPasswordResetToken(userId: number, tokenHash: string, expiresAt: Date) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(passwordResetTokens).where(and(eq(passwordResetTokens.userId, userId), isNull(passwordResetTokens.usedAt)));
  const result = await db.insert(passwordResetTokens).values({ userId, tokenHash, expiresAt });
  return result[0].insertId;
}

/** Atomically consume a valid reset token. Only the winner of concurrent requests receives a user ID. */
export async function consumePasswordResetToken(tokenHash: string): Promise<number | undefined> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const token = await db.select().from(passwordResetTokens)
    .where(and(eq(passwordResetTokens.tokenHash, tokenHash), isNull(passwordResetTokens.usedAt), gt(passwordResetTokens.expiresAt, new Date())))
    .limit(1);
  if (!token.length) return undefined;
  const result = await db.update(passwordResetTokens).set({ usedAt: new Date() })
    .where(and(eq(passwordResetTokens.id, token[0].id), isNull(passwordResetTokens.usedAt)));
  const affectedRows = Number((result[0] as { affectedRows?: number } | undefined)?.affectedRows ?? 0);
  return affectedRows === 1 ? token[0].userId : undefined;
}

export type OrganizationRole = "owner" | "admin" | "estimator" | "viewer";

export type OrganizationMembership = {
  membershipId: number;
  organizationId: number;
  organizationName: string;
  organizationSlug: string;
  role: OrganizationRole;
};

export async function getOrganizationMembership(userId: number, organizationId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select({
    membershipId: organizationMembers.id,
    organizationId: organizations.id,
    organizationName: organizations.name,
    organizationSlug: organizations.slug,
    role: organizationMembers.role,
  })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizationMembers.organizationId, organizations.id))
    .where(and(
      eq(organizationMembers.userId, userId),
      eq(organizationMembers.organizationId, organizationId),
      eq(organizations.status, "active"),
    ))
    .limit(1);
  return rows.length ? rows[0] : undefined;
}

export async function getDefaultOrganizationMembership(userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select({
    membershipId: organizationMembers.id,
    organizationId: organizations.id,
    organizationName: organizations.name,
    organizationSlug: organizations.slug,
    role: organizationMembers.role,
  })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizationMembers.organizationId, organizations.id))
    .where(and(eq(organizationMembers.userId, userId), eq(organizations.status, "active")))
    .orderBy(organizationMembers.createdAt)
    .limit(1);
  return rows.length ? rows[0] : undefined;
}

export async function listUserOrganizations(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    membershipId: organizationMembers.id,
    organizationId: organizations.id,
    organizationName: organizations.name,
    organizationSlug: organizations.slug,
    role: organizationMembers.role,
  })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizationMembers.organizationId, organizations.id))
    .where(and(eq(organizationMembers.userId, userId), eq(organizations.status, "active")))
    .orderBy(organizations.name);
}

export async function listOrganizationMembers(organizationId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    membershipId: organizationMembers.id,
    userId: users.id,
    name: users.name,
    email: users.email,
    role: organizationMembers.role,
    createdAt: organizationMembers.createdAt,
  })
    .from(organizationMembers)
    .innerJoin(users, eq(organizationMembers.userId, users.id))
    .where(eq(organizationMembers.organizationId, organizationId))
    .orderBy(organizationMembers.createdAt);
}

export async function listOrganizationInvitations(organizationId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    id: organizationInvitations.id,
    email: organizationInvitations.email,
    role: organizationInvitations.role,
    expiresAt: organizationInvitations.expiresAt,
    acceptedAt: organizationInvitations.acceptedAt,
    createdAt: organizationInvitations.createdAt,
  })
    .from(organizationInvitations)
    .where(eq(organizationInvitations.organizationId, organizationId))
    .orderBy(desc(organizationInvitations.createdAt));
}

export async function createOrganizationInvitation(input: {
  organizationId: number;
  email: string;
  role: "admin" | "estimator" | "viewer";
  tokenHash: string;
  invitedByUserId: number;
  expiresAt: Date;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(organizationInvitations).values(input);
  return Number(result[0].insertId);
}

export async function updateOrganizationMemberRole(organizationId: number, membershipId: number, role: "admin" | "estimator" | "viewer") {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(organizationMembers).set({ role })
    .where(and(eq(organizationMembers.id, membershipId), eq(organizationMembers.organizationId, organizationId)));
}

export async function removeOrganizationMember(organizationId: number, membershipId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(organizationMembers)
    .where(and(eq(organizationMembers.id, membershipId), eq(organizationMembers.organizationId, organizationId)));
}

export async function listPlatformOrganizations() {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({ organization: organizations, subscription: organizationSubscriptions, plan: subscriptionPlans })
    .from(organizations)
    .leftJoin(organizationSubscriptions, eq(organizations.id, organizationSubscriptions.organizationId))
    .leftJoin(subscriptionPlans, eq(organizationSubscriptions.planId, subscriptionPlans.id))
    .orderBy(desc(organizations.createdAt));
  return Promise.all(rows.map(async (row) => ({ ...row, usage: await getOrganizationUsage(row.organization.id) })));
}

export async function getOrganizationProjects(organizationId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(projects).where(eq(projects.organizationId, organizationId)).orderBy(desc(projects.updatedAt));
}

export async function getProjectByOrganizationId(projectId: number, organizationId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId)))
    .limit(1);
  return result.length ? result[0] : undefined;
}

export async function updateProjectInOrganization(projectId: number, organizationId: number, updates: Partial<InsertProject>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(projects).set(updates)
    .where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId)));
}

export async function deleteProjectInOrganization(projectId: number, organizationId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const project = await getProjectByOrganizationId(projectId, organizationId);
  if (!project) throw new Error("Project not found or access denied");
  await db.delete(measurements).where(eq(measurements.projectId, projectId));
  await db.delete(textAnnotations).where(eq(textAnnotations.projectId, projectId));
  await db.delete(cutouts).where(eq(cutouts.projectId, projectId));
  await db.delete(dimensionLines).where(eq(dimensionLines.projectId, projectId));
  await db.delete(callouts).where(eq(callouts.projectId, projectId));
  await db.delete(planTabs).where(eq(planTabs.projectId, projectId));
  await db.delete(projects).where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId)));
}

export async function updateMeasurementIfInOrganization(measurementId: number, organizationId: number, updates: Partial<InsertMeasurement>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const measurement = await db.select({ id: measurements.id })
    .from(measurements)
    .innerJoin(projects, eq(measurements.projectId, projects.id))
    .where(and(eq(measurements.id, measurementId), eq(projects.organizationId, organizationId)))
    .limit(1);
  if (!measurement.length) throw new Error("Measurement not found or access denied");
  await db.update(measurements).set(updates).where(eq(measurements.id, measurementId));
}

export async function deleteMeasurementIfInOrganization(measurementId: number, organizationId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const measurement = await db.select({ id: measurements.id })
    .from(measurements)
    .innerJoin(projects, eq(measurements.projectId, projects.id))
    .where(and(eq(measurements.id, measurementId), eq(projects.organizationId, organizationId)))
    .limit(1);
  if (!measurement.length) throw new Error("Measurement not found or access denied");
  await db.delete(measurements).where(eq(measurements.id, measurementId));
}

export async function getOrganizationCountingCategories(organizationId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(countingCategories)
    .where(eq(countingCategories.organizationId, organizationId))
    .orderBy(desc(countingCategories.createdAt));
}

export async function updateCountingCategoryInOrganization(
  id: number,
  organizationId: number,
  updates: { name?: string; measurementType?: "area" | "linear" | "count" },
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(countingCategories).set(updates)
    .where(and(eq(countingCategories.id, id), eq(countingCategories.organizationId, organizationId)));
}

export async function deleteCountingCategoryInOrganization(id: number, organizationId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(countingCategories)
    .where(and(eq(countingCategories.id, id), eq(countingCategories.organizationId, organizationId)));
}

export async function getSubscriptionPlanById(planId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const plans = await db.select().from(subscriptionPlans).where(eq(subscriptionPlans.id, planId)).limit(1);
  return plans.length ? plans[0] : undefined;
}

export async function listPublicSubscriptionPlans() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(subscriptionPlans)
    .where(and(eq(subscriptionPlans.isActive, true), eq(subscriptionPlans.isSystemPlan, false)))
    .orderBy(subscriptionPlans.priceCents, subscriptionPlans.name);
}

export async function listAllSubscriptionPlans() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(subscriptionPlans).orderBy(subscriptionPlans.isSystemPlan, subscriptionPlans.priceCents, subscriptionPlans.name);
}

export async function createSubscriptionPlan(input: typeof subscriptionPlans.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(subscriptionPlans).values(input);
  return Number(result[0].insertId);
}

export async function updateSubscriptionPlan(planId: number, updates: Partial<typeof subscriptionPlans.$inferInsert>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(subscriptionPlans).set(updates).where(eq(subscriptionPlans.id, planId));
}

export async function getActiveSubscriptionPlanByStripePriceId(stripePriceId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const plans = await db.select().from(subscriptionPlans)
    .where(and(eq(subscriptionPlans.stripePriceId, stripePriceId), eq(subscriptionPlans.isActive, true)))
    .limit(1);
  return plans.length ? plans[0] : undefined;
}

export async function getOrganizationSubscription(organizationId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const subscriptions = await db.select({ subscription: organizationSubscriptions, plan: subscriptionPlans })
    .from(organizationSubscriptions)
    .innerJoin(subscriptionPlans, eq(organizationSubscriptions.planId, subscriptionPlans.id))
    .where(eq(organizationSubscriptions.organizationId, organizationId))
    .limit(1);
  return subscriptions.length ? subscriptions[0] : undefined;
}

export async function getOrganizationUsage(organizationId: number) {
  const db = await getDb();
  if (!db) return { projectCount: 0, seatCount: 0 };
  const [projectRows, seatRows] = await Promise.all([
    db.select({ id: projects.id }).from(projects).where(eq(projects.organizationId, organizationId)),
    db.select({ id: organizationMembers.id }).from(organizationMembers).where(eq(organizationMembers.organizationId, organizationId)),
  ]);
  return { projectCount: projectRows.length, seatCount: seatRows.length };
}

export async function updateOrganizationSubscriptionByOrganization(
  organizationId: number,
  updates: Partial<Pick<typeof organizationSubscriptions.$inferInsert,
    "planId" | "status" | "provider" | "stripeCustomerId" | "stripeSubscriptionId" | "trialEndsAt" | "currentPeriodStart" | "currentPeriodEnd" | "cancelAtPeriodEnd" | "canceledAt"
  >>,
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(organizationSubscriptions).set(updates)
    .where(eq(organizationSubscriptions.organizationId, organizationId));
}

export async function getOrganizationSubscriptionByStripeCustomerId(stripeCustomerId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const subscriptions = await db.select().from(organizationSubscriptions)
    .where(eq(organizationSubscriptions.stripeCustomerId, stripeCustomerId))
    .limit(1);
  return subscriptions.length ? subscriptions[0] : undefined;
}

/** Returns false for a duplicate provider event, enabling safe webhook retries. */
export async function recordBillingWebhookEvent(provider: string, providerEventId: string, eventType: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  try {
    await db.insert(billingWebhookEvents).values({ provider, providerEventId, eventType, processedAt: new Date() });
    return true;
  } catch (error) {
    const message = String(error);
    if (message.includes("Duplicate") || message.includes("duplicate") || message.includes("1062")) return false;
    throw error;
  }
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
  
  const result = await db.select({ project: projects }).from(projects)
    .leftJoin(organizationMembers, eq(projects.organizationId, organizationMembers.organizationId))
    .where(and(
      eq(projects.id, projectId),
      or(eq(projects.userId, userId), eq(organizationMembers.userId, userId)),
    ))
    .limit(1);
  
  return result.length > 0 ? result[0].project : undefined;
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
  const project = await getProjectById(projectId, userId);
  if (!project) throw new Error("Project not found or access denied");
  await db.update(projects).set(updates).where(eq(projects.id, projectId));
}

export async function deleteProject(projectId: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const project = await getProjectById(projectId, userId);
  if (!project) throw new Error("Project not found or access denied");
  
  // Delete all measurements first
  await db.delete(measurements).where(eq(measurements.projectId, projectId));
  
  // Delete the project
  await db.delete(projects).where(eq(projects.id, projectId));
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
  const result = await db.select({ projectUserId: projects.userId, memberUserId: organizationMembers.userId })
    .from(measurements)
    .innerJoin(projects, eq(measurements.projectId, projects.id))
    .leftJoin(organizationMembers, eq(projects.organizationId, organizationMembers.organizationId))
    .where(eq(measurements.id, measurementId))
    .limit(1);

  if (!result.length || (result[0].projectUserId !== userId && result[0].memberUserId !== userId)) {
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
  const result = await db.select({ projectUserId: projects.userId, memberUserId: organizationMembers.userId })
    .from(measurements)
    .innerJoin(projects, eq(measurements.projectId, projects.id))
    .leftJoin(organizationMembers, eq(projects.organizationId, organizationMembers.organizationId))
    .where(eq(measurements.id, measurementId))
    .limit(1);

  if (!result.length || (result[0].projectUserId !== userId && result[0].memberUserId !== userId)) {
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
  // Permit the direct project owner or a member of the project organization.
  const result = await db.select({ tab: planTabs })
    .from(planTabs)
    .innerJoin(projects, eq(planTabs.projectId, projects.id))
    .leftJoin(organizationMembers, eq(projects.organizationId, organizationMembers.organizationId))
    .where(and(
      eq(planTabs.id, tabId),
      or(eq(projects.userId, userId), eq(organizationMembers.userId, userId)),
    ))
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
