import { expect, test, type Page } from "@playwright/test";

const stagingAppUrl = process.env.STAGING_APP_URL ?? "";

const browserEvidence = new WeakMap<Page, { consoleErrors: string[]; failedRequests: string[] }>();

test.beforeEach(async ({ page }) => {
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("requestfailed", (request) => failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText ?? "unknown"}`));
  browserEvidence.set(page, { consoleErrors, failedRequests });
});

test.afterEach(async ({ page }, testInfo) => {
  const evidence = browserEvidence.get(page) ?? { consoleErrors: [], failedRequests: [] };
  await testInfo.attach("console-evidence", { contentType: "application/json", body: Buffer.from(JSON.stringify(evidence.consoleErrors, null, 2)) });
  await testInfo.attach("network-failures", { contentType: "application/json", body: Buffer.from(JSON.stringify(evidence.failedRequests, null, 2)) });
});

test("staging accepts safe anonymous browser traffic without triggering commerce actions", async ({ page, request }) => {
  expect(stagingAppUrl, "STAGING_APP_URL is required for the staging browser smoke.").not.toBe("");
  const health = await request.get("/api/health");
  expect(health.status()).toBe(200);
  await expect(health.json()).resolves.toMatchObject({ ok: true, database: "ok" });

  await page.goto("/login");
  await expect(page).toHaveURL(new RegExp(`${new URL(stagingAppUrl).origin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/login`));
  await expect(page.getByRole("heading", { name: "登入直播商務後台" })).toBeVisible();
});
