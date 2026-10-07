import path from "node:path";
import { defineConfig } from "vitest/config";
import { assertLocalTestDatabase } from "./scripts/local-database-safety";
assertLocalTestDatabase("DATABASE_URL", process.env.DATABASE_URL);
assertLocalTestDatabase("DIRECT_URL", process.env.DIRECT_URL);
if (process.env.TRACKING_DISPOSABLE !== "verified-loopback" || process.env.DATABASE_URL !== process.env.DIRECT_URL) throw new Error("Tracking QA requires its isolated database.");
export default defineConfig({ envDir: false, resolve: { alias: { "@": path.resolve(__dirname, "src") } }, test: { include: ["src/lib/tracking-settings.db.test.ts", "src/lib/tracking-purchase-outbox.db.test.ts"], fileParallelism: false, testTimeout: 15000 } });
