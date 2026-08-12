# SaaS Transformation — Tier 3 Impact Assessment

## Change Summary

- **What & why:** Convert the current single-user roofing takeoff application into a branded, multi-tenant SaaS. Customers will use email/password accounts rather than Manus login, belong to isolated organizations, receive a 14-day no-card trial, and subscribe through Stripe.
- **Risk tier & reason:** **Tier 3**. The work changes authentication, authorization, billing, database ownership, storage isolation, and every project-data access path.
- **Owner requirement:** The existing owner account and every existing project must remain accessible. The owner becomes the platform master owner and owner of the migrated default organization.

## Design Note

- **Constraints:** Existing project data must be preserved; all measurement artifacts remain associated with their project; customer login must not require a Manus account; access must be isolated by organization; plan definitions need to be configurable later; trial checkout must not require a card.
- **Alternatives considered:**
  - Continue with Manus OAuth: rejected because customers would need Manus accounts.
  - Third-party hosted identity: rejected for this product because the agreed authentication preference is database-stored email/password only.
  - Self-hosted credentials and signed sessions: selected because it supports branded customer access and full control of lifecycle, roles, and organization ownership.
- **Chosen approach & tradeoff:** Add database-backed password credentials and opaque, revocable server sessions. Each user joins one or more organizations through membership records. This adds secure password hashing, session rotation, rate limiting, and password-reset delivery responsibilities, but avoids external customer identity dependencies.
- **Contract defined first:** Every protected tRPC request will resolve an authenticated user, an active organization membership, a membership role, and billing status. Project-resource mutations will verify that the resource belongs to the active organization before reading or modifying it.

## Blast Radius

- **Callers and dependents found:**
  - `server/_core/context.ts` resolves `ctx.user` only through `sdk.authenticateRequest`.
  - `server/_core/trpc.ts` exposes only user-level `protectedProcedure` and global `adminProcedure`.
  - `server/_core/sdk.ts` signs JWTs containing the Manus `openId` and synchronizes users from Manus.
  - `server/routers.ts` scopes `projects.list`, project reads, and project mutations to `ctx.user.id`.
  - `server/db.ts` scopes projects through `projects.userId`; project descendants depend on project ownership joins or project identifiers without a reusable organization authorization boundary.
  - `client/src/_core/hooks/useAuth.ts`, `Home.tsx`, `Projects.tsx`, and `App.tsx` assume a single Manus-authenticated user with no workspace or billing state.
- **DB tables touched:** `users`, `projects`, `measurements`, `countingCategories`, `textAnnotations`, `planTabs`, `cutouts`, `dimensionLines`, and `callouts`; new tables will cover organizations, memberships, plans, subscriptions, invitations, credential sessions, password resets, and billing webhook events.
- **Contracts changed:** Yes. Auth response, request context, all project-bearing procedure inputs, project list response, and protected authorization middleware will become organization-aware.
- **Hidden layers:** S3 object keys currently begin with user IDs and must be organization-prefixed for all new files; React Query keys must include active organization; Stripe webhooks and billing secrets will be required; no background scheduler is required for core trial enforcement because the server checks expiration on access.

## Data and Migration

- **Expand-to-contract sequence:**
  1. Add nullable organization and credential columns plus all new organization/billing/auth tables.
  2. Create a default organization for the existing owner and a master-owner membership.
  3. Backfill every existing project with that organization ID; descendants remain protected through their parent project.
  4. Deploy organization-aware reads that continue to accept legacy project rows while validation confirms the backfill.
  5. Make organization ownership non-null only after backfill verification.
  6. Add customer credential signup and Stripe billing paths behind server-side entitlement checks.
- **Reversible:** Yes during the expand stage. A rollback preserves the old user-owned project path because `projects.userId` is retained until migration verification completes. New organization rows remain additive; no existing project data is deleted.
- **Backfill:** One idempotent transaction for the existing owner organization and project organization IDs, re-runnable safely using null checks and unique constraints.
- **Backward compatibility during rollout:** Existing owner authentication remains available only until the equivalent email/password owner credential has been initialized and verified. New data-access code will authorize by organization while retaining `userId` as legacy attribution.

## Security Pass

- **Object-level authorization:** Every resource access will validate organization membership through its project owner. Direct IDs for projects, measurements, tabs, annotations, cutouts, dimensions, and callouts cannot cross organization boundaries.
- **Injection and output encoding:** Drizzle query builders and Zod schemas remain mandatory for all inputs. User-supplied labels and organization names are rendered as text, never injected as HTML.
- **Secrets:** Passwords will be salted and hashed with Argon2id or bcrypt; no password, Stripe secret, webhook signing secret, or SMTP credential may enter source control or logs.
- **Dependencies:** Authentication, billing, and email dependencies will be installed from maintained packages, locked in `pnpm-lock.yaml`, and checked with the full test suite and package audit.
- **Other controls:** Login and password-reset endpoints require per-IP/email rate limiting; session cookies will be `HttpOnly`, `Secure` in production, and `SameSite=Lax`; billing webhooks require verified signatures and idempotency records; platform-admin billing pages require master-owner authorization.

## Resilience

- **Outbound timeouts:** Stripe and SMTP calls will have bounded timeouts.
- **Retries:** Only idempotent outbound calls may retry with capped exponential backoff; Stripe webhook event IDs make subscription processing idempotent.
- **Degraded behavior:** A temporary Stripe outage will not expose paid-only actions to new or expired organizations. Existing active access remains based on the last validated subscription record until the configured grace policy expires. Email failures will not reveal account existence.

## Verification Plan

- **Build:** Run `pnpm check` and production build after each major phase.
- **Tests:** Add unit and tRPC integration coverage for password hashing, session expiration, organization isolation, roles, invitation acceptance, trial expiration, plan limits, webhook idempotency, and migration backfill.
- **Edge cases:** Empty organization, duplicate email, expired token, invalid password, resource ID from another organization, expired trial, duplicate webhook, canceled subscription, owner migration rerun, and concurrent membership changes.
- **Manual workflow:** Verify sign-up → organization creation → 14-day trial → project upload → billing upgrade → cancellation → access enforcement in the deployed environment, with separate accounts from different organizations.

## Rollout and Recovery

- **Strategy:** Ship schema expansion and owner backfill first, verify migration counts, then enable email/password authentication and billing UI in stages. Stripe activation remains disabled until webhook secrets and live product IDs are configured.
- **Monitoring:** Log authentication failures by reason without sensitive values, unauthorized resource attempts, organization resolution failures, webhook signature failures, and Stripe event processing status. Alert on repeated failures or migration mismatch counts.
- **Rollback:** Disable new signup and billing routes, retain the legacy owner access route, and restore the prior checkpoint. Since the first schema change is additive, recovery does not require deleting migrated customer data. Expected application rollback: a few minutes after a saved checkpoint.

## Assumptions Made

- The owner will later provide a dedicated sending configuration for password-reset and welcome emails.
- Stripe products, prices, webhook secret, and production publishing keys will be added only after the application workflow is complete and the owner has a Stripe account ready.
- Google and other social login providers are intentionally excluded; customer access is email/password only.
