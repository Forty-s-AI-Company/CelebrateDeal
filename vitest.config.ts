import path from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

import { assertLocalTestDatabase } from "./scripts/local-database-safety";

const localPostgresUrl = "postgresql://postgres:postgres@localhost:54329/celebratedeal_dev?schema=public";
if (!process.env.DATABASE_URL || process.env.DATABASE_URL.startsWith("file:")) {
  process.env.DATABASE_URL = localPostgresUrl;
}
if (!process.env.DIRECT_URL || process.env.DIRECT_URL.startsWith("file:")) {
  process.env.DIRECT_URL = process.env.DATABASE_URL;
}

// Tests exercise payout creation, which must use the same fail-closed
// encryption boundary as production. This deterministic key exists only in
// the Vitest process and is never read from a developer or deployment env file.
process.env.BANK_ACCOUNT_KEYRING_JSON = JSON.stringify({
  activeKeyId: "synthetic",
  keys: {
    synthetic: Buffer.alloc(32, 17).toString("base64url"),
  },
});

assertLocalTestDatabase("DATABASE_URL", process.env.DATABASE_URL);
assertLocalTestDatabase("DIRECT_URL", process.env.DIRECT_URL);

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    exclude: [...configDefaults.exclude, "tests/e2e/**"],
    // Database integration tests share one local PostgreSQL schema. Running
    // test files concurrently lets one fixture cleanup deadlock another file's
    // serializable payment transaction, so keep file execution deterministic.
    fileParallelism: false,
    coverage: {
      provider: "v8",
      include: [
        "src/**/*.{ts,tsx}",
        "scripts/**/*.{ts,mjs}",
      ],
      exclude: [
        "**/*.test.{ts,tsx,mjs}",
        "**/*.d.ts",
      ],
      reporter: ["text", "json-summary"],
      reportsDirectory: "coverage",
      thresholds: {
        // These floors use the full source inventory, including files that are
        // currently exercised through Playwright rather than imported by unit
        // tests. Keep the global gate honest while separately protecting the
        // heavily unit-tested domain layer from coverage regressions.
        statements: 63,
        branches: 57,
        functions: 60,
        lines: 65,
        "src/lib/**.ts": {
          statements: 86,
          branches: 80,
          functions: 88,
          lines: 88,
        },
      },
    },
  },
});
