import path from "node:path";
import { defineConfig } from "vitest/config";
import { assertLocalTestDatabase } from "./scripts/local-database-safety";

const databaseUrl = process.env.DATABASE_URL;
const directUrl = process.env.DIRECT_URL;
assertLocalTestDatabase("DATABASE_URL", databaseUrl);
assertLocalTestDatabase("DIRECT_URL", directUrl);
if (process.env.COURSE_LEARNING_DISPOSABLE !== "verified-loopback" || databaseUrl !== directUrl || new URL(databaseUrl).searchParams.get("schema") !== "public") {
  throw new Error("Course learning requires its verified disposable binding.");
}
export default defineConfig({
  envDir: false,
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: { include: ["src/lib/student-course-learning.db.test.ts"], fileParallelism: false, testTimeout: 15000 },
});
