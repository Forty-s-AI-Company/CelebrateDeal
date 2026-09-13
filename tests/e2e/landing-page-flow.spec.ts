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

test("owner publishes a landing page and its public CTA preserves form attribution", async ({ page }, testInfo) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const suffix = runKey.replace(/-/g, "").slice(-12).toLowerCase();
  const pageName = `TEST ONLY Landing Page ${suffix}`;
  const slug = `test-only-landing-page-${suffix}`;
  const leadEmail = `lead-${suffix}@landing-page.test`;

  // Authentication is deliberately exercised through the public login UI.
  await page.goto("/login");
  await page.getByLabel("Email").fill(fixture.owner.email);
  await page.getByLabel("密碼").fill(fixture.password);
  await page.getByRole("button", { name: "登入" }).click();
  await expect(page).toHaveURL(/\/dashboard$/u);

  await page.goto("/landing-pages/new");
  await expect(page.getByLabel("頁面名稱")).toBeVisible();
  await page.getByLabel("頁面名稱").fill(pageName);
  await page.getByLabel("公開網址 slug").fill(slug);
  await page.getByLabel("活動場次").selectOption(fixture.live.id);
  await expect(page.getByText("正在載入編輯器…", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: screenshotPath(testInfo, "landing-page-editor.png"), fullPage: true });
  await page.getByRole("button", { name: "儲存草稿", exact: true }).click();
  // /landing-pages/new also matches a generic final segment; await the actual redirect.
  await expect(page).not.toHaveURL(/\/landing-pages\/new$/u);
  await expect(page).toHaveURL(/\/landing-pages\/[^/]+$/u);

  const editorPath = new URL(page.url()).pathname;
  const pageId = editorPath.split("/").at(-1);
  if (!pageId) throw new Error("Landing page create navigation did not include an id.");
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
  await expect(page.getByRole("heading", { name: "用一場直播，讓對的人認識你的價值" })).toBeVisible();
  await page.screenshot({ path: screenshotPath(testInfo, "landing-page-public-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: screenshotPath(testInfo, "landing-page-public-mobile.png"), fullPage: true });
  // The template copy can evolve; the public registration route is the
  // contract that matters for this journey.
  const registrationLink = page.locator('a[href^="/form/"]').first();
  await expect(registrationLink).toBeVisible();
  await registrationLink.click();
  await expect(page).toHaveURL(new RegExp(`/form/${fixture.form.slug}\\?`, "u"));
  const formUrl = new URL(page.url());
  expect(formUrl.searchParams.get("liveId")).toBe(fixture.live.id);
  expect(formUrl.searchParams.get("lp")).toBe(pageId);
  expect(formUrl.searchParams.get("utm_source")).toBe("landing-e2e");
  expect(formUrl.searchParams.get("utm_medium")).toBe("playwright");
  expect(formUrl.searchParams.get("utm_campaign")).toBe("publish-flow");

  await expect(page.getByRole("heading", { name: fixture.form.headline })).toBeVisible();
  await page.getByLabel("姓名").fill("TEST ONLY Landing Page Lead");
  await page.getByLabel("Email").fill(leadEmail);
  const submissionResponse = page.waitForResponse((response) => (
    new URL(response.url()).pathname === "/api/form-submissions" && response.request().method() === "POST"
  ));
  await page.getByRole("button", { name: fixture.form.submitLabel }).click();
  expect((await submissionResponse).status()).toBe(200);
  await expect(page.getByText(fixture.form.successMessage, { exact: true })).toBeVisible();

  await expect.poll(async () => await db.formSubmission.findFirst({
    where: { formId: fixture.form.id, email: leadEmail },
    select: { liveId: true, attribution: true },
  })).toEqual({
    liveId: fixture.live.id,
    attribution: {
      landingPageId: pageId,
      utm: { source: "landing-e2e", medium: "playwright", campaign: "publish-flow" },
    },
  });
  expect(pageErrors).toEqual([]);
});
