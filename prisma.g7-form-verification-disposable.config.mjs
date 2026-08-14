import { defineConfig } from "prisma/config";

const databaseUrl = process.env.DIRECT_URL ?? "";
const schema = process.env.G7_FORM_VERIFICATION_SCHEMA ?? "";
const parsed = new URL(databaseUrl);

if (parsed.protocol !== "postgresql:" || parsed.hostname !== "127.0.0.1") {
  throw new Error("[g7_form_verification_db] only loopback PostgreSQL is allowed");
}
if (!/^g7_13b_[a-f0-9]{16}$/u.test(schema) || parsed.searchParams.get("schema") !== schema) {
  throw new Error("[g7_form_verification_db] disposable schema marker is invalid");
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  engine: "classic",
  migrations: { path: "prisma/migrations" },
  datasource: { url: databaseUrl },
});
