import { defineConfig, devices } from "@playwright/test";
import { assertLocalTestDatabase } from "./scripts/local-database-safety";

const databaseUrl = process.env.DATABASE_URL;
const directUrl = process.env.DIRECT_URL;
const schema = process.env.G7_COMMERCE_BROWSER_SCHEMA;
const baseURL = process.env.E2E_BASE_URL;

assertLocalTestDatabase("DATABASE_URL", databaseUrl);
assertLocalTestDatabase("DIRECT_URL", directUrl);
if (!schema || !/^g7_04_browser_[a-f0-9]{16}$/u.test(schema)) {
  throw new Error("[g7_commerce_browser] disposable schema marker is invalid.");
}
if (!baseURL || !/^http:\/\/127\.0\.0\.1:\d+$/u.test(baseURL)) {
  throw new Error("[g7_commerce_browser] base URL must be loopback HTTP.");
}
if (
  new URL(databaseUrl).searchParams.get("schema") !== schema
  || new URL(directUrl).searchParams.get("schema") !== schema
) {
  throw new Error("[g7_commerce_browser] database URLs do not match the disposable schema marker.");
}

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "commerce-orders.spec.ts",
  timeout: 45_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
