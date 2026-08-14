import path from "node:path";
import { defineConfig } from "vitest/config";

import { assertLocalTestDatabase } from "./scripts/local-database-safety";

const databaseUrl = process.env.DATABASE_URL;
const directUrl = process.env.DIRECT_URL;
const schema = process.env.G7_EMAIL_DISPOSABLE_SCHEMA;
const suite = process.env.G7_EMAIL_DISPOSABLE_SUITE;

assertLocalTestDatabase("DATABASE_URL", databaseUrl);
assertLocalTestDatabase("DIRECT_URL", directUrl);

if (!schema || !/^g7_email_[a-f0-9]{16}$/u.test(schema)) {
  throw new Error("[g7_email_db] disposable schema marker is invalid.");
}

if (suite !== "delivery" && suite !== "reconciliation" && suite !== "refund") {
  throw new Error("[g7_email_db] disposable suite marker is invalid.");
}

if (new URL(databaseUrl).searchParams.get("schema") !== schema
  || new URL(directUrl).searchParams.get("schema") !== schema) {
  throw new Error("[g7_email_db] database URLs do not match the disposable schema marker.");
}

export default defineConfig({
  // The marker-gated runner owns every value below. Prevent Vite from loading
  // developer or deployment environment files into this disposable test.
  envDir: false,
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    include: [suite === "delivery"
      ? "src/lib/email-delivery.db.test.ts"
      : suite === "reconciliation"
        ? "src/lib/live-reminder-reconciliation.db.test.ts"
        : "src/lib/payuni-refund-ambiguous.db.test.ts"],
    fileParallelism: false,
    env: {
      DATABASE_URL: databaseUrl,
      DIRECT_URL: directUrl,
      G7_EMAIL_DISPOSABLE_SCHEMA: schema,
      G7_EMAIL_DISPOSABLE_SUITE: suite,
      CSRF_SECRET: "g7-email-disposable-signing-key-longer-than-32-bytes",
      NEXT_PUBLIC_APP_URL: "https://g7-email.example.test",
    },
  },
});
