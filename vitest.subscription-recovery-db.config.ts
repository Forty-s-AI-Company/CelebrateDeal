import path from "node:path";
import { defineConfig } from "vitest/config";
import { assertLocalTestDatabase } from "./scripts/local-database-safety";
assertLocalTestDatabase("DATABASE_URL", process.env.DATABASE_URL);
assertLocalTestDatabase("DIRECT_URL", process.env.DIRECT_URL);
if (process.env.WP4_DISPOSABLE_RUNNER_MARKER !== "verified-loopback" || process.env.DATABASE_URL !== process.env.DIRECT_URL) throw new Error("Requires owned disposable database");
export default defineConfig({ envDir: false, resolve: { alias: { "@": path.resolve(__dirname, "src") } }, test: { include: ["src/lib/platform-subscription-refund.db.test.ts", "src/lib/wp4-buyer-ops.db.test.ts", "src/lib/wp4-subscription-ops.db.test.ts", "src/lib/payment-webhooks.test.ts"], fileParallelism: false, testTimeout: 20000 } });
