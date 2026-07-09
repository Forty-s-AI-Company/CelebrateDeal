import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("password helpers", () => {
  it("verifies a password hashed with scrypt", () => {
    const hash = hashPassword("demo1234");

    expect(verifyPassword("demo1234", hash)).toBe(true);
    expect(verifyPassword("wrong-password", hash)).toBe(false);
  });
});
