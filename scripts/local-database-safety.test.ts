import { describe, expect, it } from "vitest";

import {
  assertLocalTestDatabase,
  classifyLocalTestDatabase,
} from "./local-database-safety";

describe("local test database safety", () => {
  it.each([
    "postgresql://user:password@localhost:5432/celebratedeal_dev",
    "postgres://user:password@127.0.0.1:54329/celebratedeal_test?schema=public",
    "postgresql://user:password@[::1]:5432/celebratedeal_e2e",
    "postgresql://user:password@localhost:5432/celebratedeal_ci",
    "postgresql://user:password@localhost:5432/celebratedeal_wp17_ci",
    "postgresql://user:password@localhost:5432/celebratedeal_wp18_ci",
  ])("accepts an isolated loopback database", (value) => {
    expect(classifyLocalTestDatabase(value)).toEqual({ safe: true });
  });

  it.each([
    [undefined, "missing"],
    ["not-a-url", "invalid-url"],
    ["file:./local.db", "unsupported-protocol"],
    ["postgresql://user:password@database.example/celebratedeal_test", "non-loopback"], // secret-scan: allow-test-fixture
    ["postgresql://user:password@localhost:5432/postgres", "unsafe-database"], // secret-scan: allow-test-fixture
    ["postgresql://user:password@localhost:5432/celebratedeal_wp19_ci", "unsafe-database"], // secret-scan: allow-test-fixture
  ] as const)("rejects unsafe metadata without returning connection details", (value, category) => {
    expect(classifyLocalTestDatabase(value)).toEqual({ safe: false, category });
  });

  it("throws only a safe category", () => {
    const sensitiveValue =
      "postgresql://sensitive-user:sensitive-password@database.example/production"; // secret-scan: allow-test-fixture

    expect(() => assertLocalTestDatabase("DATABASE_URL", sensitiveValue)).toThrow(
      "[local_database_safety] DATABASE_URL rejected; category=non-loopback",
    );

    try {
      assertLocalTestDatabase("DATABASE_URL", sensitiveValue);
    } catch (error) {
      const output = error instanceof Error ? error.message : String(error);
      expect(output).not.toContain("sensitive-user");
      expect(output).not.toContain("sensitive-password");
      expect(output).not.toContain("database.example");
      expect(output).not.toContain("production");
    }
  });
});
