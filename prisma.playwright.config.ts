import { defineConfig } from "prisma/config";
import { assertLocalTestDatabase } from "./scripts/local-database-safety";

// 僅使用測試程序明確注入的 URL，不載入 dotenv 或退回互動開發資料庫。
for (const name of ["DATABASE_URL", "DIRECT_URL"] as const) {
  const value = process.env[name];
  assertLocalTestDatabase(name, value);
  if (!/^\/celebratedeal_(?:test|e2e|ci)$/u.test(new URL(value).pathname)) {
    throw new Error(`[playwright_database_safety] ${name} rejected; category=non-disposable`);
  }
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  engine: "classic",
  migrations: { path: "prisma/migrations" },
  datasource: { url: process.env.DIRECT_URL! },
});
