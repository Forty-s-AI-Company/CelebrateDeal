import path from "node:path";
import { defineConfig } from "vitest/config";
import { assertLocalTestDatabase } from "./scripts/local-database-safety";

const databaseUrl = process.env.DATABASE_URL;
assertLocalTestDatabase("DATABASE_URL", databaseUrl);
assertLocalTestDatabase("DIRECT_URL", process.env.DIRECT_URL);
if (process.env.PENDING_REFUND_DISPOSABLE !== "verified-loopback" || databaseUrl !== process.env.DIRECT_URL
  || new URL(databaseUrl).searchParams.get("schema") !== "public") throw new Error("Refund QA requires verified disposable binding.");
export default defineConfig({ envDir: false, resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: { include: ["src/lib/payuni-pending-refund-proof.db.test.ts", "src/lib/payuni-refund-execution-full.db.test.ts",
    "src/lib/payuni-refund-execution.db.test.ts", "src/lib/payuni-refund-ambiguous.db.test.ts"], fileParallelism: false, testTimeout: 15000 } });
