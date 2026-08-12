import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import type { OrganizationMembership } from "../db";
import * as db from "../db";
import { sdk } from "./sdk";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
  activeOrganization: OrganizationMembership | null;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;
  let activeOrganization: OrganizationMembership | null = null;

  try {
    user = await sdk.authenticateRequest(opts.req);
    const requestedOrganizationId = Number(opts.req.headers["x-organization-id"]);
    activeOrganization = Number.isSafeInteger(requestedOrganizationId) && requestedOrganizationId > 0
      ? await db.getOrganizationMembership(user.id, requestedOrganizationId) ?? null
      : await db.getDefaultOrganizationMembership(user.id) ?? null;
  } catch (error) {
    // Authentication is optional for public procedures.
    user = null;
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
    activeOrganization,
  };
}
