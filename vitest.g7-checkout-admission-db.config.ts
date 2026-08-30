import path from "node:path";
import { defineConfig } from "vitest/config";
import { assertLocalTestDatabase } from "./scripts/local-database-safety";

const databaseUrl = process.env.DATABASE_URL;
const directUrl = process.env.DIRECT_URL;
const schema = process.env.G7_CHECKOUT_ADMISSION_DISPOSABLE_SCHEMA;

assertLocalTestDatabase("DATABASE_URL", databaseUrl);
assertLocalTestDatabase("DIRECT_URL", directUrl);
if (!schema || !/^g7_14_[a-f0-9]{16}$/u.test(schema)) {
  throw new Error("[g7_checkout_admission_db] disposable schema marker is invalid.");
}
if (
  new URL(databaseUrl).searchParams.get("schema") !== schema
  || new URL(directUrl).searchParams.get("schema") !== schema
) {
  throw new Error("[g7_checkout_admission_db] database URLs do not match the disposable schema marker.");
}

export default defineConfig({
  envDir: false,
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    include: [
      "src/lib/checkout-admission.db.test.ts",
      "src/lib/inventory-reservations.test.ts",
    ],
    fileParallelism: false,
    env: {
      DATABASE_URL: databaseUrl,
      DIRECT_URL: directUrl,
      G7_CHECKOUT_ADMISSION_DISPOSABLE_SCHEMA: schema,
      CSRF_SECRET: "g7-14-synthetic-checkout-admission-secret-at-least-32-bytes",
    },
  },
});
