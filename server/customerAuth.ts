import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "crypto";
import type { Request, Response } from "express";
import { parse } from "cookie";
import { CUSTOMER_SESSION_COOKIE, CUSTOMER_SESSION_TTL_MS, PASSWORD_RESET_TTL_MS } from "../shared/const";
import { getSessionCookieOptions } from "./_core/cookies";

const BCRYPT_ROUNDS = 12;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 8;

type RateLimitBucket = { count: number; windowStartedAt: number };
const loginAttempts = new Map<string, RateLimitBucket>();

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function createOrganizationSlug(name: string) {
  const base = name.trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72) || "roofing-team";
  return `${base}-${randomBytes(4).toString("hex")}`;
}

export function validatePassword(password: string) {
  if (password.length < 10) return "Password must contain at least 10 characters.";
  if (password.length > 128) return "Password must contain no more than 128 characters.";
  return null;
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(password: string, passwordHash: string) {
  return bcrypt.compare(password, passwordHash);
}

/** The database stores only SHA-256 token hashes; raw tokens are browser- or email-only. */
export function createOpaqueToken() {
  return randomBytes(32).toString("base64url");
}

export function hashOpaqueToken(rawToken: string) {
  return createHash("sha256").update(rawToken).digest("hex");
}

export function customerSessionExpiry() {
  return new Date(Date.now() + CUSTOMER_SESSION_TTL_MS);
}

export function passwordResetExpiry() {
  return new Date(Date.now() + PASSWORD_RESET_TTL_MS);
}

export function readCustomerSessionToken(req: Request) {
  const cookies = parse(req.headers.cookie ?? "");
  return cookies[CUSTOMER_SESSION_COOKIE] ?? null;
}

export function setCustomerSessionCookie(res: Response, req: Request, token: string) {
  res.cookie(CUSTOMER_SESSION_COOKIE, token, {
    ...getSessionCookieOptions(req),
    sameSite: "lax",
    maxAge: CUSTOMER_SESSION_TTL_MS,
  });
}

export function clearCustomerSessionCookie(res: Response, req: Request) {
  res.clearCookie(CUSTOMER_SESSION_COOKIE, {
    ...getSessionCookieOptions(req),
    sameSite: "lax",
    maxAge: -1,
  });
}

function getLoginRateLimitKey(req: Request, normalizedEmail: string) {
  const forwardedFor = req.headers["x-forwarded-for"];
  const ip = Array.isArray(forwardedFor)
    ? forwardedFor[0]
    : forwardedFor?.split(",")[0]?.trim() ?? req.ip ?? "unknown";
  return `${ip}:${normalizedEmail}`;
}

/** Simple server-process guard. A durable distributed guard can replace this without changing callers. */
export function isLoginRateLimited(req: Request, normalizedEmail: string) {
  const now = Date.now();
  const key = getLoginRateLimitKey(req, normalizedEmail);
  const current = loginAttempts.get(key);
  if (!current || now - current.windowStartedAt >= LOGIN_WINDOW_MS) return false;
  return current.count >= LOGIN_MAX_ATTEMPTS;
}

export function recordFailedLogin(req: Request, normalizedEmail: string) {
  const now = Date.now();
  const key = getLoginRateLimitKey(req, normalizedEmail);
  const current = loginAttempts.get(key);
  if (!current || now - current.windowStartedAt >= LOGIN_WINDOW_MS) {
    loginAttempts.set(key, { count: 1, windowStartedAt: now });
    return;
  }
  loginAttempts.set(key, { ...current, count: current.count + 1 });
}

export function clearFailedLogins(req: Request, normalizedEmail: string) {
  loginAttempts.delete(getLoginRateLimitKey(req, normalizedEmail));
}
