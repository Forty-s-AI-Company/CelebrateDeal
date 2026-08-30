import path from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

import { assertLocalTestDatabase } from "./scripts/local-database-safety";
import { findNodeTapContractTests } from "./scripts/node-tap-contract-tests";

// Keep automated tests away from the developer's interactive local database.
// `celebratedeal_test` is a disposable loopback-only database that must be
// provisioned from the repository migrations before database-backed test runs.
const localPostgresUrl = "postgresql://postgres:postgres@localhost:54329/celebratedeal_test?schema=public";
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

const nodeTapContractTests = findNodeTapContractTests(__dirname)
  .map((filePath) => path.relative(__dirname, filePath).split(path.sep).join("/"));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    exclude: [
      ...configDefaults.exclude,
      "tests/e2e/**",
      // Historical AI Team snapshots are evidence, not active test sources.
      ".ai-team/tmp/**",
      // Browser QA mirrors are disposable copies of the source tree, not
      // independent test suites. Running them here duplicates work and can
      // mix their temporary fixtures with the canonical local database.
      "tmp/**",
      // Node TAP contracts run through `npm run test:contracts`.
      ...nodeTapContractTests,
      // These PostgreSQL race tests require isolated owner schemas and run
      // only through `npm run test:db:concurrency`.
      "src/app/actions.mfa-db.test.ts",
      "src/app/actions.payout-db.test.ts",
    ],
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
      reporter: ["text", "json", "json-summary"],
      reportsDirectory: "coverage",
      thresholds: process.env.COMBINED_COVERAGE_COLLECTION === "true" ? undefined : {
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
