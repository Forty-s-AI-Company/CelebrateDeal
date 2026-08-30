import { describe, expect, it } from "vitest";
import {
  hashPassword,
  hashPasswordAsync,
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
});
