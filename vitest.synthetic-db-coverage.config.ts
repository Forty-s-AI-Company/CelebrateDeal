import path from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

import { assertLocalTestDatabase } from "./scripts/local-database-safety";
import { findNodeTapContractTests } from "./scripts/node-tap-contract-tests";

type SchemaOwner = "wp17" | "wp18";

function readCoverageOwner(owner: SchemaOwner) {
  const prefix = owner.toUpperCase();
  const schema = process.env[`${prefix}_COVERAGE_DISPOSABLE_SCHEMA`];
  const databaseUrl = process.env[`${prefix}_COVERAGE_DATABASE_URL`];
  const directUrl = process.env[`${prefix}_COVERAGE_DIRECT_URL`];
  const expectedSchema = new RegExp(`^${owner}_[a-z0-9_]+$`);

  if (!schema || !expectedSchema.test(schema) || !databaseUrl || !directUrl) {
    throw new Error(`[synthetic_db_coverage] ${owner} coverage environment is incomplete.`);
  }
  assertLocalTestDatabase("DATABASE_URL", databaseUrl);
  assertLocalTestDatabase("DIRECT_URL", directUrl);

  if (new URL(databaseUrl).searchParams.get("schema") !== schema || new URL(directUrl).searchParams.get("schema") !== schema) {
    throw new Error(`[synthetic_db_coverage] ${owner} owner flag and URL schema must match.`);
  }

  return { databaseUrl, directUrl, schema };
}

const wp17 = readCoverageOwner("wp17");
const wp18 = readCoverageOwner("wp18");

// The payout concurrency case reaches the same fail-closed encryption
// boundary as the normal Vitest suite. Keep this deterministic key scoped to
// the runner process; it never reads developer or deployment configuration.
process.env.BANK_ACCOUNT_KEYRING_JSON = JSON.stringify({
  activeKeyId: "synthetic",
  keys: {
    synthetic: Buffer.alloc(32, 17).toString("base64url"),
  },
});

const nodeTapContractTests = findNodeTapContractTests(__dirname)
  .map((filePath) => path.relative(__dirname, filePath).split(path.sep).join("/"));
const testExclude = [
  ...configDefaults.exclude,
  "tests/e2e/**",
  ".ai-team/tmp/**",
  ...nodeTapContractTests,
];

const resolve = {
  alias: {
    "@": path.resolve(__dirname, "src"),
  },
};

const coverage = {
  provider: "v8" as const,
  include: ["src/**/*.{ts,tsx}", "scripts/**/*.{ts,mjs}"],
  exclude: ["**/*.test.{ts,tsx,mjs}", "**/*.d.ts"],
  reporter: ["text", "json-summary"],
  reportsDirectory: "coverage",
  thresholds: {
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
};

export default defineConfig({
  resolve,
  test: {
    // Both projects retain serial file execution, while their database owners
    // are deliberately disjoint to keep concurrent DB fixtures isolated.
    fileParallelism: false,
    coverage,
    projects: [
      {
        // Vitest projects resolve their own Vite config and do not inherit the
        // root alias, so keep the existing @ -> src contract explicit here.
        resolve,
        test: {
          name: "wp18-main",
          exclude: [...testExclude, "src/app/actions.mfa-db.test.ts"],
          env: {
            DATABASE_URL: wp18.databaseUrl,
            DIRECT_URL: wp18.directUrl,
            WP18_DISPOSABLE_SCHEMA: wp18.schema,
          },
        },
      },
      {
        resolve,
        test: {
          name: "wp17-db",
          include: ["src/app/actions.mfa-db.test.ts"],
          exclude: testExclude,
          env: {
            DATABASE_URL: wp17.databaseUrl,
            DIRECT_URL: wp17.directUrl,
            WP17_DISPOSABLE_SCHEMA: wp17.schema,
          },
        },
      },
    ],
  },
});
