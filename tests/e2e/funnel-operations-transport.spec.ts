import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "@playwright/test";
import { Prisma, PrismaClient } from "@prisma/client";
import { createLandingPageFixture } from "../fixtures/landing-page";
import { assertLocalTestDatabase } from "../../scripts/local-database-safety";
import { createGoalFunnelStepPages } from "../../src/lib/funnel-goal-step-pages";

const db = new PrismaClient();
test.use({ trace: "off", screenshot: "off", video: "off", serviceWorkers: "block" });
test.afterAll(() => db.$disconnect());
test("diagnostic: isolated operations save without prior editor transitions", async ({ page, baseURL }) => {
  assertLocalTestDatabase("DATABASE_URL", process.env.DATABASE_URL);
  const fixture = await createLandingPageFixture(db, randomUUID());
  const origin = new URL(baseURL!).origin;
  const content = createGoalFunnelStepPages({ id: "test_flow", name: "TEST ONLY Transport", domain: `test-${randomUUID()}`, goal: "audience" })!;
  const row = await db.landingPage.create({ data: { vendorId: fixture.vendor.id, projectId: fixture.project.id, name: content.flow.name, slug: content.flow.domain, draftContent: content as unknown as Prisma.InputJsonValue } });
  const events: Array<{ method: string; path: string; status?: number; failed?: string; finished?: boolean; action?: boolean }> = [];
  const pathCategory = (url: string) => new URL(url).pathname.replace(/\/landing-pages\/[^/]+/u, "/landing-pages/:id").replace(/\/_next\/static\/.+/u, "/_next/static/:asset");
  let completedSaves = 0;
  const requests = new WeakMap<object, (typeof events)[number]>();
  page.on("requestfinished", request => { const event = requests.get(request); if (event) event.finished = true; });
  page.on("response", response => {
    if (new URL(response.url()).origin !== origin) return;
    const event: (typeof events)[number] = { method: response.request().method(), path: pathCategory(response.url()), status: response.status(), finished: false };
    events.push(event);
    requests.set(response.request(), event);
    void response.request().headerValue("next-action").then(value => { event.action = Boolean(value); }).catch(() => undefined);
  });
  page.on("requestfailed", request => events.push({ method: request.method(), path: pathCategory(request.url()), failed: request.failure()?.errorText }));
  await page.context().route(url => url.origin !== origin, route => route.request().url() === "https://rsms.me/inter/inter.css" ? route.fulfill({ status: 200, contentType: "text/css", body: "/* offline */" }) : route.abort("blockedbyclient"));
  try {
    await page.goto("/login");
    await page.getByLabel("Email").fill(fixture.owner.email);
    await page.getByLabel("密碼").fill(fixture.password);
    await page.getByRole("button", { name: "登入", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard$/u);
    const operationsPath = `/landing-pages/${row.id}/operations`;
    const operationsResponse = await page.goto(operationsPath);
    expect(operationsResponse?.status()).toBe(200);
    await expect(page).toHaveURL(new RegExp(`${operationsPath}$`, "u"));
    await expect(page.getByRole("heading", { name: "無法開啟 Funnel", exact: true })).toHaveCount(0);
    const panel = page.getByRole("region", { name: "Funnel 管理", exact: true });
    await expect(panel).toBeVisible();
    for (let index = 1; index <= 3; index++) {
      await panel.getByRole("button", { name: "Funnel settings", exact: true }).click();
      const settings = page.getByRole("dialog", { name: "Funnel settings", exact: true });
      await settings.getByLabel("名稱", { exact: true }).fill(`TEST ONLY Transport ${index}`);
      await settings.getByRole("button", { name: "儲存設定", exact: true }).click();
      await expect.poll(async () => (await db.landingPage.findUniqueOrThrow({ where: { id: row.id } })).revision).toBe(index + 1);
      await expect(settings).toHaveCount(0);
      completedSaves++;
    }
  } finally {
    const compact = events.filter(item => item.method === "POST" || item.failed);
    console.log(`QA_DIAGNOSTIC ${JSON.stringify({ completedSaves })}`);
    for (const event of compact.slice(-12)) console.log(`QA_DIAGNOSTIC ${JSON.stringify(event)}`);
    if (process.env.FUNNEL_OPERATIONS_QA_SCREENSHOT_DIR) writeFileSync(join(process.env.FUNNEL_OPERATIONS_QA_SCREENSHOT_DIR, "transport-diagnostics.json"), JSON.stringify(compact, null, 2));
  }
});
