import path from "node:path";
import { config as loadEnv } from "dotenv";
import { configDefaults, defineConfig } from "vitest/config";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

const localPostgresUrl = "postgresql://postgres:postgres@localhost:54329/celebratedeal_dev?schema=public";
if (!process.env.DATABASE_URL || process.env.DATABASE_URL.startsWith("file:")) {
  process.env.DATABASE_URL = localPostgresUrl;
}
if (!process.env.DIRECT_URL || process.env.DIRECT_URL.startsWith("file:")) {
  process.env.DIRECT_URL = process.env.DATABASE_URL;
}

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    exclude: [...configDefaults.exclude, "tests/e2e/**", "tests/visual/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      reportsDirectory: "coverage",
      thresholds: {
        statements: 75,
        branches: 60,
        functions: 75,
        lines: 75,
      },
      exclude: [
        "**/*.config.*",
        "**/*.d.ts",
        "**/tests/**",
        "scripts/**",
        "automation/**",
      ],
    },
  },
});
