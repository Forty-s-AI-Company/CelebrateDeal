import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { Prisma, PrismaClient } from "@prisma/client";
import { createFunnelFlow } from "../../src/lib/funnel-flow";
import { createFunnelStepPages } from "../../src/lib/funnel-step-pages";
import { createLandingPageFixture, type LandingPageFixture } from "../fixtures/landing-page";

const db = new PrismaClient();
const runKey = randomUUID();
const suffix = runKey.replace(/-/g, "").slice(-12).toLowerCase();
const legacySlug = `test-only-availability-${suffix}`;
const funnelSlug = `test-only-availability-funnel-${suffix}`;
const legacyContent = { schemaVersion: 1, data: { root: {}, content: [] } };
let fixture: LandingPageFixture;
let legacyPageId: string;
let funnelPageId: string;

test.use({ trace: "off", screenshot: "off", video: "off" });
// Both tests toggle the same synthetic project.
test.describe.configure({ mode: "serial" });

async function publishedPage(slug: string, content: Prisma.InputJsonValue, formId: string | null) {
  const created = await db.landingPage.create({
    data: { vendorId: fixture.vendor.id, projectId: fixture.project.id, name: `TEST ONLY ${slug}`, slug, draftContent: content },
    select: { id: true },
  });
  const version = await db.landingPageVersion.create({
    data: { vendorId: fixture.vendor.id, pageId: created.id, version: 1, content, formId },
    select: { id: true },
  });
  await db.landingPage.update({ where: { id: created.id }, data: { status: "published", publishedVersionId: version.id, publishedAt: new Date() } });
  return created.id;
}

test.beforeAll(async () => {
  fixture = await createLandingPageFixture(db, runKey);
  legacyPageId = await publishedPage(legacySlug, legacyContent, fixture.form.id);
  const funnel = createFunnelStepPages(createFunnelFlow({ id: `flow_${suffix}`, name: "TEST ONLY 名單", goal: "audience", domain: funnelSlug })!)!;
  funnelPageId = await publishedPage(funnelSlug, funnel as unknown as Prisma.InputJsonValue, null);
});

test.afterAll(async () => {
  // The dedicated runner owns the disposable database lifecycle.
  await db.$disconnect();
});

async function expectAnonymous404(response: Awaited<ReturnType<import("@playwright/test").APIRequestContext["get"]>>, slug: string) {
  expect(response.status()).toBe(404);
  expect(response.headers()["cache-control"]).toBe("no-store, max-age=0");
  expect(response.headers()["x-robots-tag"]).toBe("noindex");
  const body = await response.text();
  expect(body).not.toContain(slug);
  expect(body).not.toContain("專案尚未發布");
  expect(body).toContain("<h1>404</h1>");
}

test("anonymous visitors get a real HTTP status for unavailable public URLs", async ({ request }) => {
  test.setTimeout(60_000);
  expect((await request.get(`/lp/${legacySlug}`)).status()).toBe(200);
  expect((await request.head(`/lp/${legacySlug}`)).status()).toBe(200);
  expect((await request.get(`/lp/${funnelSlug}`)).status()).toBe(200);

  await db.salesProject.update({ where: { id: fixture.project.id }, data: { status: "draft", publishedAt: null } });
  try {
    await expectAnonymous404(await request.get(`/lp/${legacySlug}`), legacySlug);
    expect((await request.head(`/lp/${legacySlug}`)).status()).toBe(404);
  } finally {
    await db.salesProject.update({ where: { id: fixture.project.id }, data: { status: "published", publishedAt: new Date("2030-01-01T00:00:00.000Z") } });
  }

  await db.registrationForm.update({ where: { id: fixture.form.id }, data: { isActive: false } });
  try {
    await expectAnonymous404(await request.get(`/lp/${legacySlug}`), legacySlug);
  } finally {
    await db.registrationForm.update({ where: { id: fixture.form.id }, data: { isActive: true } });
  }
  expect((await request.get(`/lp/${legacySlug}`)).status()).toBe(200);

  await expectAnonymous404(await request.get(`/lp/${funnelSlug}/no-such-step`), funnelSlug);
  await db.landingPage.update({ where: { id: funnelPageId }, data: { operations: { invalid: true } } });
  try {
    await expectAnonymous404(await request.get(`/lp/${funnelSlug}`), funnelSlug);
  } finally {
    await db.landingPage.update({ where: { id: funnelPageId }, data: { operations: Prisma.DbNull } });
  }
  await expectAnonymous404(await request.get(`/lp/test-only-missing-${suffix}`), `test-only-missing-${suffix}`);
});

test("the merchant sees why the public URL is unavailable", async ({ page }) => {
  test.setTimeout(90_000);
  await db.salesProject.update({ where: { id: fixture.project.id }, data: { status: "draft", publishedAt: null } });
  try {
    await page.goto("/login");
    await page.getByLabel("Email").fill(fixture.owner.email);
    await page.getByLabel("密碼").fill(fixture.password);
    await page.getByRole("button", { name: "登入" }).click();
    await expect(page).toHaveURL(/\/dashboard$/u);
    await page.goto(`/landing-pages/${legacyPageId}`);
    const panel = page.getByRole("region", { name: "公開網址狀態" });
    await expect(panel).toContainText("專案尚未發布，公開網址目前無法開啟");
    await expect(panel.getByRole("link", { name: "尚無有效且已驗證的商家付款方式" })).toHaveAttribute("href", "/billing/payment-methods");
    await expect(panel.getByRole("link", { name: "前往專案檢查與發布" })).toHaveAttribute("href", `/projects/${fixture.project.id}`);
  } finally {
    await db.salesProject.update({ where: { id: fixture.project.id }, data: { status: "published", publishedAt: new Date("2030-01-01T00:00:00.000Z") } });
  }
});
