import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { expect, test, type TestInfo } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { createLandingPageFixture, type LandingPageFixture } from "../fixtures/landing-page";

const db = new PrismaClient();
const runKey = randomUUID();
let fixture: LandingPageFixture;

test.use({ trace: "off", screenshot: "off", video: "off" });

test.beforeAll(async () => {
  fixture = await createLandingPageFixture(db, runKey);
});

test.afterAll(async () => {
  // The dedicated runner owns the disposable database lifecycle. Keeping the
  // rows makes a failing journey inspectable without touching shared data.
  await db.$disconnect();
});

function screenshotPath(testInfo: TestInfo, filename: string) {
  const screenshotDirectory = process.env.LANDING_QA_SCREENSHOT_DIR;
  return screenshotDirectory ? join(screenshotDirectory, filename) : testInfo.outputPath(filename);
}

test("owner creates, edits, publishes and reloads a structured Funnel page", async ({ page }, testInfo) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const suffix = runKey.replace(/-/g, "").slice(-12).toLowerCase();
  const pageName = `TEST ONLY Landing Page ${suffix}`;
  const slug = `test-only-landing-page-${suffix}`;

  // Authentication is deliberately exercised through the public login UI.
  await page.goto("/login");
  await page.getByLabel("Email").fill(fixture.owner.email);
  await page.getByLabel("密碼").fill(fixture.password);
  await page.getByRole("button", { name: "登入" }).click();
  await expect(page).toHaveURL(/\/dashboard$/u);

  await page.goto("/landing-pages/new");
  await expect(page.getByRole("heading", { name: "建立新的 Funnel" })).toBeVisible();
  await page.getByLabel("名稱 *").fill(pageName);
  await page.getByLabel("Funnel 網址 *").fill(slug);
  await page.getByRole("button", { name: /建立名單/u }).click();
  await page.getByRole("button", { name: "儲存", exact: true }).click();
  await expect(page).toHaveURL(/\/landing-pages\/[^/?]+\/operations$/u);
  const pageId = new URL(page.url()).pathname.split("/").at(-2);
  if (!pageId) throw new Error("Funnel create navigation did not include an id.");
  await page.getByRole("button", { name: "套用模板", exact: true }).first().click();
  await expect(page.getByRole("status").filter({ hasText: "模板已套用" })).toBeVisible();
  await page.getByRole("button", { name: "Edit Page", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/landing-pages/${pageId}\\?step=`, "u"));
  await page.getByRole("button", { name: "頁面設定", exact: true }).click();
  await expect(page.getByLabel("頁面名稱")).toBeVisible();
  await page.getByLabel("活動場次").selectOption(fixture.live.id);
  await expect(page.getByText("正在載入編輯器…", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: screenshotPath(testInfo, "landing-page-editor.png"), fullPage: true });
  await page.getByRole("button", { name: "儲存草稿", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/landing-pages/${pageId}\\?step=`, "u"));
  await expect(page.getByRole("button", { name: "發布已儲存草稿" })).toBeEnabled();
  await page.getByRole("button", { name: "發布已儲存草稿" }).click();

  await expect.poll(async () => await db.landingPage.findUnique({
    where: { id: pageId },
    select: { status: true, publishedVersionId: true, publishedAt: true, draftFormId: true, draftLiveId: true },
  })).toEqual({
    status: "published",
    publishedVersionId: expect.any(String),
    publishedAt: expect.any(Date),
    draftFormId: fixture.form.id,
    draftLiveId: fixture.live.id,
  });
  const storedPage = await db.landingPage.findUniqueOrThrow({
    where: { id: pageId },
    select: { id: true, vendorId: true, projectId: true, slug: true, publishedVersionId: true, publishedVersion: { select: { formId: true, liveId: true } } },
  });
  expect(storedPage).toMatchObject({
    id: pageId,
    vendorId: fixture.vendor.id,
    projectId: fixture.project.id,
    slug,
    publishedVersion: { formId: fixture.form.id, liveId: fixture.live.id },
  });

  // Saving a later draft must not mutate the immutable public version.
  // Wait for the refreshed published UI, not only the earlier database write.
  await expect(page.getByRole("link", { name: /查看公開頁/u })).toBeVisible();
  await page.getByLabel("頁面名稱").fill(`${pageName} 草稿更新`);
  await page.getByRole("button", { name: "儲存草稿", exact: true }).click();
  await expect.poll(async () => await db.landingPage.findUnique({
    where: { id: pageId },
    select: { name: true, publishedVersionId: true },
  })).toEqual({ name: `${pageName} 草稿更新`, publishedVersionId: storedPage.publishedVersionId });

  await page.goto(`/lp/${slug}?utm_source=landing-e2e&utm_medium=playwright&utm_campaign=publish-flow`);
  await expect(page.getByRole("heading", { name: "一起把時間變成真正的改變" })).toBeVisible();
  await page.screenshot({ path: screenshotPath(testInfo, "landing-page-public-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: screenshotPath(testInfo, "landing-page-public-mobile.png"), fullPage: true });
  await page.goto(`/lp/${slug}/thank-you`);
  await expect(page.getByRole("heading", { name: "感謝／下載頁" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "感謝／下載頁" })).toBeVisible();
  expect(pageErrors).toEqual([]);
});
