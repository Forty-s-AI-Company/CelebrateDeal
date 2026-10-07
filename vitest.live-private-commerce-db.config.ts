import path from "node:path";
import { defineConfig } from "vitest/config";

// The disposable runner injects an approved loopback URL. Never load dotenv.
export default defineConfig({ envDir: false, resolve: { alias: { "@": path.resolve("src") } },
  test: { include: ["src/lib/live-purchase-broadcasts.db.test.ts"], fileParallelism: false, testTimeout: 15_000 } });
