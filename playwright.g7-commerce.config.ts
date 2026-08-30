import { defineConfig, devices } from "@playwright/test";
import { assertLocalTestDatabase } from "./scripts/local-database-safety";

const databaseUrl = process.env.DATABASE_URL;
const directUrl = process.env.DIRECT_URL;
const schema = process.env.G7_COMMERCE_BROWSER_SCHEMA;
const baseURL = process.env.E2E_BASE_URL;
const e2eTarget = process.env.G7_COMMERCE_BROWSER_E2E_TARGET ?? "commerce";
const chromiumExecutablePath = process.env.E2E_CHROMIUM_EXECUTABLE_PATH;

assertLocalTestDatabase("DATABASE_URL", databaseUrl);
assertLocalTestDatabase("DIRECT_URL", directUrl);
if (!schema || !/^g7_04_browser_[a-f0-9]{16}$/u.test(schema)) {
  throw new Error("[g7_commerce_browser] disposable schema marker is invalid.");
}
if (!baseURL || !/^http:\/\/127\.0\.0\.1:\d+$/u.test(baseURL)) {
  throw new Error("[g7_commerce_browser] base URL must be loopback HTTP.");
}
if (e2eTarget !== "commerce" && e2eTarget !== "wp7-one-stop") {
  throw new Error("[g7_commerce_browser] E2E target is invalid.");
}
if (
  new URL(databaseUrl).searchParams.get("schema") !== schema
  || new URL(directUrl).searchParams.get("schema") !== schema
) {
  throw new Error("[g7_commerce_browser] database URLs do not match the disposable schema marker.");
}

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: e2eTarget === "wp7-one-stop"
    ? "wp7-one-stop-webinar-flow.spec.ts"
    : "commerce-orders.spec.ts",
  timeout: e2eTarget === "wp7-one-stop" ? 90_000 : 45_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL,
    // The WP7 journey follows an in-memory verification URL. Never persist a
    // browser trace that could retain its one-time token or submitted PII.
    trace: e2eTarget === "wp7-one-stop" ? "off" : "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{
    name: "chromium",
    use: {
      ...devices["Desktop Chrome"],
      ...(chromiumExecutablePath ? { launchOptions: { executablePath: chromiumExecutablePath } } : {}),
    },
  }],
});
