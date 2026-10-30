import path from "node:path";
import { defineConfig } from "vitest/config";

import { assertLocalTestDatabase, resolveLocalDatabaseUrl } from "./scripts/local-database-safety";

// F-055 opt-in stress run: `npm run test:db:stress`. It runs only the
// Serializable contention file, with 50 concurrent callers per path, against
// the same disposable loopback `celebratedeal_*` database the normal suite
// uses. Staging and production URLs are rejected before any connection.
const concurrency = process.env.SERIALIZABLE_STRESS_CONCURRENCY || "50";
const databaseUrl = resolveLocalDatabaseUrl(process.env.DATABASE_URL, "test");
assertLocalTestDatabase("DATABASE_URL", databaseUrl);
const directUrl = !process.env.DIRECT_URL || process.env.DIRECT_URL.startsWith("file:") ? databaseUrl : process.env.DIRECT_URL;
assertLocalTestDatabase("DIRECT_URL", directUrl);

// Give every caller its own connection so the contention happens inside
// PostgreSQL, not in Prisma's pool queue. SERIALIZABLE_STRESS_CONNECTION_LIMIT
// overrides it to reproduce a small serverless pool.
const stressUrl = new URL(databaseUrl);
stressUrl.searchParams.set("connection_limit", process.env.SERIALIZABLE_STRESS_CONNECTION_LIMIT || String(Number(concurrency) + 10));
stressUrl.searchParams.set("pool_timeout", "30");

process.env.BANK_ACCOUNT_KEYRING_JSON = JSON.stringify({
  activeKeyId: "synthetic",
  keys: { synthetic: Buffer.alloc(32, 17).toString("base64url") },
});

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    include: ["src/lib/serializable-stress.db.test.ts"],
    // Print each path's [serializable_stress] measurement line, not only the summary.
    reporters: ["verbose"],
    fileParallelism: false,
    env: {
      DATABASE_URL: stressUrl.toString(),
      DIRECT_URL: directUrl,
      SERIALIZABLE_STRESS_CONCURRENCY: concurrency,
    },
  },
});
