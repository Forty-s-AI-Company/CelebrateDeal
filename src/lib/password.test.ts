import { describe, expect, it } from "vitest";
import {
  hashPassword,
  hashPasswordAsync,
  isUnusablePasswordHash,
  unusablePasswordHash,
  verifyPassword,
  verifyPasswordAsync,
} from "./password";

describe("password helpers", () => {
  it("verifies a password hashed with scrypt", () => {
    const hash = hashPassword("demo1234");

    expect(verifyPassword("demo1234", hash)).toBe(true);
    expect(verifyPassword("wrong-password", hash)).toBe(false);
  });

  it("hashes and verifies passwords without blocking request-time callers", async () => {
    const hash = await hashPasswordAsync("demo1234", "async-test-salt");

    await expect(verifyPasswordAsync("demo1234", hash)).resolves.toBe(true);
    await expect(verifyPasswordAsync("wrong-password", hash)).resolves.toBe(false);
  });

  it("rejects malformed asynchronous hash records", async () => {
    await expect(verifyPasswordAsync("demo1234", "not-a-scrypt-record")).resolves.toBe(false);
  });

  it("never verifies any password against an unusable hash", async () => {
    const hash = unusablePasswordHash("account_email_revert");
    expect(isUnusablePasswordHash(hash)).toBe(true);
    expect(isUnusablePasswordHash(hashPassword("demo1234"))).toBe(false);
    for (const password of ["", "demo1234", hash, "account_email_revert", "unusable"]) {
      expect(verifyPassword(password, hash)).toBe(false);
      await expect(verifyPasswordAsync(password, hash)).resolves.toBe(false);
    }
  });
});
