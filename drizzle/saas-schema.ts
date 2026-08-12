import { boolean, index, int, json, mysqlEnum, mysqlTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

/** Tenant workspace. All customer project data is isolated by this organization boundary. */
export const organizations = mysqlTable("organizations", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 100 }).notNull(),
  status: mysqlEnum("status", ["active", "suspended", "archived"]).default("active").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  uniqueIndex("organizations_slug_unique").on(table.slug),
]);

/** Organization-level authorization; no project access is granted without an active membership. */
export const organizationMembers = mysqlTable("organizationMembers", {
  id: int("id").autoincrement().primaryKey(),
  organizationId: int("organizationId").notNull(),
  userId: int("userId").notNull(),
  role: mysqlEnum("role", ["owner", "admin", "estimator", "viewer"]).default("estimator").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  uniqueIndex("organization_members_org_user_unique").on(table.organizationId, table.userId),
  index("organization_members_user_idx").on(table.userId),
]);

/** Configurable products managed by the platform owner and mirrored to Stripe when billing is configured. */
export const subscriptionPlans = mysqlTable("subscriptionPlans", {
  id: int("id").autoincrement().primaryKey(),
  code: varchar("code", { length: 80 }).notNull(),
  name: varchar("name", { length: 120 }).notNull(),
  description: text("description"),
  isActive: boolean("isActive").default(true).notNull(),
  isSystemPlan: boolean("isSystemPlan").default(false).notNull(),
  priceCents: int("priceCents").notNull().default(0),
  currency: varchar("currency", { length: 3 }).notNull().default("usd"),
  billingInterval: mysqlEnum("billingInterval", ["month", "year"]).default("month").notNull(),
  trialDays: int("trialDays").notNull().default(14),
  /** Null represents an unlimited entitlement. */
  maxProjects: int("maxProjects"),
  /** Null represents unlimited organization members. */
  maxSeats: int("maxSeats"),
  features: json("features"),
  stripeProductId: varchar("stripeProductId", { length: 255 }),
  stripePriceId: varchar("stripePriceId", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  uniqueIndex("subscription_plans_code_unique").on(table.code),
  index("subscription_plans_active_idx").on(table.isActive),
]);

/** Current billing and trial state for a tenant workspace. */
export const organizationSubscriptions = mysqlTable("organizationSubscriptions", {
  id: int("id").autoincrement().primaryKey(),
  organizationId: int("organizationId").notNull(),
  planId: int("planId").notNull(),
  status: mysqlEnum("status", ["trialing", "active", "past_due", "canceled", "unpaid", "incomplete", "paused"]).default("trialing").notNull(),
  provider: varchar("provider", { length: 32 }).notNull().default("stripe"),
  stripeCustomerId: varchar("stripeCustomerId", { length: 255 }),
  stripeSubscriptionId: varchar("stripeSubscriptionId", { length: 255 }),
  trialEndsAt: timestamp("trialEndsAt"),
  currentPeriodStart: timestamp("currentPeriodStart"),
  currentPeriodEnd: timestamp("currentPeriodEnd"),
  cancelAtPeriodEnd: boolean("cancelAtPeriodEnd").default(false).notNull(),
  canceledAt: timestamp("canceledAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  uniqueIndex("organization_subscriptions_org_unique").on(table.organizationId),
  uniqueIndex("organization_subscriptions_stripe_subscription_unique").on(table.stripeSubscriptionId),
  index("organization_subscriptions_status_idx").on(table.status),
]);

/** Opaque server sessions; the browser stores only the random token, never its hash. */
export const authSessions = mysqlTable("authSessions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  tokenHash: varchar("tokenHash", { length: 128 }).notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  revokedAt: timestamp("revokedAt"),
  lastUsedAt: timestamp("lastUsedAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("auth_sessions_token_hash_unique").on(table.tokenHash),
  index("auth_sessions_user_idx").on(table.userId),
]);

/** One-time reset records. Raw reset tokens are never persisted. */
export const passwordResetTokens = mysqlTable("passwordResetTokens", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  tokenHash: varchar("tokenHash", { length: 128 }).notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  usedAt: timestamp("usedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("password_reset_token_hash_unique").on(table.tokenHash),
  index("password_reset_user_idx").on(table.userId),
]);

/** Pending team invitation. Email delivery is intentionally separate from invitation creation. */
export const organizationInvitations = mysqlTable("organizationInvitations", {
  id: int("id").autoincrement().primaryKey(),
  organizationId: int("organizationId").notNull(),
  email: varchar("email", { length: 320 }).notNull(),
  role: mysqlEnum("role", ["admin", "estimator", "viewer"]).default("estimator").notNull(),
  tokenHash: varchar("tokenHash", { length: 128 }).notNull(),
  invitedByUserId: int("invitedByUserId").notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  acceptedAt: timestamp("acceptedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("organization_invitations_token_hash_unique").on(table.tokenHash),
  index("organization_invitations_org_idx").on(table.organizationId),
  index("organization_invitations_email_idx").on(table.email),
]);

/** Stripe event idempotency ledger. A verified event is processed once even if Stripe retries it. */
export const billingWebhookEvents = mysqlTable("billingWebhookEvents", {
  id: int("id").autoincrement().primaryKey(),
  provider: varchar("provider", { length: 32 }).notNull().default("stripe"),
  providerEventId: varchar("providerEventId", { length: 255 }).notNull(),
  eventType: varchar("eventType", { length: 255 }).notNull(),
  processedAt: timestamp("processedAt"),
  failedAt: timestamp("failedAt"),
  failureReason: text("failureReason"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("billing_webhook_events_provider_event_unique").on(table.provider, table.providerEventId),
  index("billing_webhook_events_type_idx").on(table.eventType),
]);
