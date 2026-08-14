import path from "node:path";
import { defineConfig } from "vitest/config";
import { assertLocalTestDatabase } from "./scripts/local-database-safety";

const databaseUrl = process.env.DATABASE_URL;
const directUrl = process.env.DIRECT_URL;
const schema = process.env.G7_FORM_VERIFICATION_SCHEMA;

assertLocalTestDatabase("DATABASE_URL", databaseUrl);
assertLocalTestDatabase("DIRECT_URL", directUrl);
if (!schema || !/^g7_13b_[a-f0-9]{16}$/u.test(schema)) {
  throw new Error("[g7_form_verification_db] disposable schema marker is invalid");
}
if (new URL(databaseUrl).searchParams.get("schema") !== schema || new URL(directUrl).searchParams.get("schema") !== schema) {
  throw new Error("[g7_form_verification_db] database URLs do not match the disposable schema marker");
}

export default defineConfig({
  envDir: false,
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    include: [
      "src/lib/form-submission-verification.db.test.ts",
      "src/app/api/form-submissions/route.db.test.ts",
    ],
    fileParallelism: false,
    env: {
      DATABASE_URL: databaseUrl,
      DIRECT_URL: directUrl,
      G7_FORM_VERIFICATION_SCHEMA: schema,
      CSRF_SECRET: "g7-form-verification-disposable-signing-key-32-bytes",
      NEXT_PUBLIC_APP_URL: "http://127.0.0.1",
    },
  },
});
