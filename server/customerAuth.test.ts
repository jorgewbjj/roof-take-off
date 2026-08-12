import { describe, expect, it } from "vitest";
import {
  createOpaqueToken,
  createOrganizationSlug,
  hashOpaqueToken,
  hashPassword,
  normalizeEmail,
  validatePassword,
  verifyPassword,
} from "./customerAuth";

describe("customer credential authentication helpers", () => {
  it("normalizes customer email addresses consistently", () => {
    expect(normalizeEmail("  Estimator@Example.COM ")).toBe("estimator@example.com");
  });

  it("enforces the minimum password policy", () => {
    expect(validatePassword("short")).toContain("at least 10 characters");
    expect(validatePassword("commercial-roofing-password")).toBeNull();
  });

  it("hashes passwords without retaining the plaintext", async () => {
    const password = "commercial-roofing-password";
    const passwordHash = await hashPassword(password);
    expect(passwordHash).not.toContain(password);
    await expect(verifyPassword(password, passwordHash)).resolves.toBe(true);
    await expect(verifyPassword("incorrect-password", passwordHash)).resolves.toBe(false);
  });

  it("creates non-reversible, unique opaque session tokens", () => {
    const first = createOpaqueToken();
    const second = createOpaqueToken();
    expect(first).not.toBe(second);
    expect(hashOpaqueToken(first)).not.toBe(first);
    expect(hashOpaqueToken(first)).toHaveLength(64);
  });

  it("creates URL-safe organization slugs with a collision-resistant suffix", () => {
    const slug = createOrganizationSlug("Seal To Roofing & Sons");
    expect(slug).toMatch(/^seal-to-roofing-sons-[a-f0-9]{8}$/);
  });
});
