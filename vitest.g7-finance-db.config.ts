import path from "node:path";
import { defineConfig } from "vitest/config";

import { assertLocalTestDatabase } from "./scripts/local-database-safety";

const databaseUrl = process.env.DATABASE_URL;
const directUrl = process.env.DIRECT_URL;
const schema = process.env.WP18_DISPOSABLE_SCHEMA;

assertLocalTestDatabase("DATABASE_URL", databaseUrl);
assertLocalTestDatabase("DIRECT_URL", directUrl);

if (!schema || !/^wp18_g7_[a-f0-9]{16}$/.test(schema)) {
  throw new Error("[g7_finance_db] disposable schema marker is invalid.");
}

if (new URL(databaseUrl).searchParams.get("schema") !== schema
  || new URL(directUrl).searchParams.get("schema") !== schema) {
  throw new Error("[g7_finance_db] database URLs do not match the disposable schema marker.");
}

const syntheticBankKeyring = JSON.stringify({
  activeKeyId: "synthetic",
  keys: {
    synthetic: Buffer.alloc(32, 17).toString("base64url"),
  },
});

export default defineConfig({
  // This focused integration run receives every value from its marker-gated
  // runner. Disable Vite's automatic .env loading so developer or deployment
  // configuration cannot enter the test process.
  envDir: false,
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    include: ["src/app/actions.payout-db.test.ts"],
    fileParallelism: false,
    env: {
      DATABASE_URL: databaseUrl,
      DIRECT_URL: directUrl,
      WP18_DISPOSABLE_SCHEMA: schema,
      BANK_ACCOUNT_KEYRING_JSON: syntheticBankKeyring,
    },
  },
});
