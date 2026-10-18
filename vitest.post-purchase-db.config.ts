import path from "node:path";
import { defineConfig } from "vitest/config";
import { assertLocalTestDatabase } from "./scripts/local-database-safety";

// Every fixture belongs to the runner's fresh loopback disposable database.
for (const name of ["DATABASE_URL", "DIRECT_URL"] as const) {
  assertLocalTestDatabase(name, process.env[name]);
  if (new URL(process.env[name]!).pathname !== "/celebratedeal_test") {
    throw new Error("Post-purchase database is not disposable");
  }
}

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    include: ["src/lib/post-purchase-upsell-access.test.ts", "src/lib/post-purchase-upsell.test.ts", "src/lib/post-purchase-credit.db.test.ts"],
    fileParallelism: false,
    env: { CSRF_SECRET: "post-purchase-disposable-synthetic-csrf-secret-v1" },
  },
});
