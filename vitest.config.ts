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
  },
});
