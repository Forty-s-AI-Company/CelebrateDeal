import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { createWebinarFunnelFixture } from "../fixtures/webinar-funnel";

const db = new PrismaClient();
const runKey = randomUUID();
let fixture: Awaited<ReturnType<typeof createWebinarFunnelFixture>>;
test.use({ trace: "off", screenshot: "off", video: "off" });
test.beforeAll(async () => { fixture = await createWebinarFunnelFixture(db, runKey); });
test.afterAll(async () => { await db.$disconnect(); });

test("Webinar owner saves settings, resolves publish validation and opens every public step", async ({ page }, testInfo) => {
  page.setDefaultTimeout(20_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  // Never send synthetic playback requests to an external server.
  await page.route("https://example.test/**", route => route.fulfill({ status: 204, body: "" }));
  const suffix = runKey.replaceAll("-", "").slice(-12);
  const slug = `test-only-webinar-${suffix}`;
  const shot = (name: string) => process.env.WEBINAR_QA_SCREENSHOT_DIR
    ? join(process.env.WEBINAR_QA_SCREENSHOT_DIR, name) : testInfo.outputPath(name);
  await page.goto("/login");
  await page.getByLabel("Email").fill(fixture.owner.email);
  await page.getByLabel("密碼").fill(fixture.password);
  await page.getByRole("button", { name: "登入" }).click();
  await expect(page).toHaveURL(/\/dashboard$/u);
  await page.goto("/landing-pages/new");
  await expect(page.getByRole("heading", { name: "建立新的 Funnel" })).toBeVisible({ timeout: 20_000 }).catch(async (error: unknown) => {
    await page.screenshot({ path: shot("webinar-create-failure.png"), fullPage: true });
    const ancestors = await page.getByLabel("名稱 *").evaluate((element) => {
      const result: Array<{ tag: string; id: string; hidden: boolean; display: string; visibility: string }> = [];
      for (let node: Element | null = element; node; node = node.parentElement) result.push({ tag: node.tagName, id: node.id, hidden: node.hasAttribute("hidden"), display: getComputedStyle(node).display, visibility: getComputedStyle(node).visibility });
      return result;
    });
    console.log(JSON.stringify({ pageErrors: errors, ancestors }));
    throw error;
  });
  await page.getByLabel("名稱 *").fill(`TEST ONLY Webinar ${suffix}`);
  await page.getByLabel("Funnel 網址 *").fill(slug);
  await page.getByRole("button", { name: /自動化 Webinar/u }).click();
  await page.getByRole("button", { name: "儲存", exact: true }).click();
  await expect(page).toHaveURL(/\/landing-pages\/[^/?]+\/operations$/u);
  const operationsPath = new URL(page.url()).pathname;
  const createdId = operationsPath.split("/").at(-2)!;
  const management = page.getByRole("region", { name: "Funnel 管理", exact: true });
  await expect(management.getByLabel("Funnel steps")).toContainText("Webinar 播放頁");
  await management.getByLabel("名稱 *", { exact: true }).fill("TEST ONLY Webinar 報名頁");
  await management.getByLabel("名稱 *", { exact: true }).press("Tab");
  await expect(management.getByRole("status")).toContainText("步驟設定已自動儲存");
  await management.getByLabel("步驟 URL Path", { exact: true }).fill("registration");
  await management.getByLabel("步驟 URL Path", { exact: true }).press("Tab");
  await expect(management.getByRole("status")).toContainText("步驟設定已自動儲存");
  await management.getByRole("button", { name: "更換模板", exact: true }).click();
  const previewButton = management.getByRole("button", { name: "完整預覽", exact: true }).first();
  await previewButton.focus();
  await expect(previewButton).toBeFocused();
  await previewButton.click();
  const templateDialog = page.getByRole("dialog", { name: /講者型活動報名頁/u });
  await expect(templateDialog.locator("[data-funnel-renderer]")).toBeVisible();
  await templateDialog.getByRole("button", { name: "手機版", exact: true }).click();
  await expect(templateDialog.locator('[data-template-preview-viewport="mobile"]')).toBeVisible();
  expect(await templateDialog.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  await page.keyboard.press("Escape");
  await expect(templateDialog).toBeHidden();
  await management.getByRole("button", { name: "取消更換模板", exact: true }).click();
  await management.getByRole("button", { name: "Edit Page", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/landing-pages/${createdId}\\?step=`, "u"));
  // Edit the actual canvas document and exercise the global toolbar's page history.
  const headline = page.locator('[data-funnel-node-type="headline"] h1');
  const originalHeadline = await headline.innerText();
  const editedHeadline = `TEST ONLY Webinar 修改標題 ${suffix}`;
  await headline.click();
  console.log(JSON.stringify({ selected: await page.locator('[data-funnel-selected="true"]').evaluateAll(nodes => nodes.map(node => ({ type: node.getAttribute('data-funnel-node-type'), id: node.getAttribute('data-funnel-node-id') }))), inspectorCount: await page.locator('[data-funnel-element-inspector]').count(), pageErrors: errors }));
  await page.screenshot({ path: shot("webinar-inspector.png"), fullPage: true, timeout: 10_000 });
  await page.locator("[data-funnel-element-inspector]").getByRole("textbox", { name: "標題", exact: true }).fill(editedHeadline);
  await expect(headline).toHaveText(editedHeadline);
  const toolbar = page.getByLabel("Funnel 編輯器工具列", { exact: true });
  await toolbar.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(headline).toHaveText(originalHeadline);
  await toolbar.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(headline).toHaveText(editedHeadline);
  await toolbar.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: /草稿已儲存|已儲存/u }).first()).toBeVisible();
  await toolbar.getByRole("button", { name: /返回 Configuration$/u }).click();
  await expect(page).toHaveURL(new RegExp(`${operationsPath.replaceAll("/", "\\/")}\\?step=`, "u"));
  await management.getByLabel("Funnel steps").getByRole("button", { name: /Webinar 感謝頁 webinar_thank_you_page$/u }).click();
  await management.getByRole("button", { name: "Edit Page", exact: true }).click();
  await expect(headline).not.toHaveText(editedHeadline);
  await page.getByRole("button", { name: /返回 Configuration$/u }).click();
  await management.getByLabel("Funnel steps").getByRole("button", { name: /TEST ONLY Webinar 報名頁 webinar_registration_page$/u }).click();
  await management.getByRole("button", { name: "Edit Page", exact: true }).click();
  await expect(headline).toHaveText(editedHeadline);
  await page.getByRole("button", { name: "頁面設定", exact: true }).click();
  await page.getByLabel("Webinar 時區", { exact: true }).fill("Asia/Taipei");
  await page.getByLabel("Webinar 開始時間（UTC）", { exact: true }).fill("2030-08-01T02:00:00.000Z");
  await page.getByLabel("Webinar 結束時間（UTC）", { exact: true }).fill("2030-08-01T03:00:00.000Z");
  await page.getByLabel("重播截止時間（UTC）", { exact: true }).fill("2030-08-08T03:00:00.000Z");
  await page.getByRole("button", { name: "儲存草稿", exact: true }).click();
  await expect(page).toHaveURL(/\/landing-pages\/(?!new$)[^/?]+\?step=[^#]+$/u);
  const editorPath = new URL(page.url()).pathname;
  const id = editorPath.split("/").at(-1)!;
  await page.reload();
  await expect(headline).toHaveText(editedHeadline);
  await page.getByRole("button", { name: "頁面設定", exact: true }).click();
  await expect(page.getByLabel("Webinar 開始時間（UTC）", { exact: true })).toHaveValue("2030-08-01T02:00:00.000Z");
  await page.getByRole("button", { name: "發布已儲存草稿", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: /Webinar.*(?:綁定|場次|影片|資源)/u })).toBeVisible();
  expect(await db.landingPage.findUniqueOrThrow({ where: { id }, select: { publishedVersionId: true } })).toEqual({ publishedVersionId: null });
  await page.getByLabel("預設報名表", { exact: true }).selectOption(fixture.form.id);
  await page.getByLabel("活動場次", { exact: true }).selectOption(fixture.live.id);
  await page.getByLabel("來源影片", { exact: true }).selectOption(fixture.live.id);
  // First verify fixed-date persistence above, then exercise an actively running event.
  const now = Date.now();
  await page.getByLabel("Webinar 開始時間（UTC）", { exact: true }).fill(new Date(now - 60_000).toISOString());
  await page.getByLabel("Webinar 結束時間（UTC）", { exact: true }).fill(new Date(now + 3_600_000).toISOString());
  await page.getByLabel("重播截止時間（UTC）", { exact: true }).fill(new Date(now + 7_200_000).toISOString());
  await page.getByRole("button", { name: "儲存草稿", exact: true }).click();
  await expect(page.getByRole("button", { name: "發布已儲存草稿", exact: true })).toBeEnabled({ timeout: 10_000 }).catch(async (error: unknown) => {
    console.log(JSON.stringify({ statuses: await page.getByRole("status").allTextContents(), alerts: await page.getByRole("alert").allTextContents(), pageErrors: errors, draft: await db.landingPage.findUnique({ where: { id }, select: { revision: true, draftLiveId: true, draftFormId: true } }) }));
    await page.screenshot({ path: shot("webinar-save-failure.png"), fullPage: true, timeout: 10_000 });
    throw error;
  });
  await page.getByRole("button", { name: "發布已儲存草稿", exact: true }).click();
  await expect(page.getByRole("link", { name: /查看公開頁/u })).toBeVisible();
  const saved = await db.landingPage.findUniqueOrThrow({ where: { id }, select: { publishedVersion: { select: { formId: true, liveId: true } } } });
  expect(saved.publishedVersion).toEqual({ formId: fixture.form.id, liveId: fixture.live.id });
  await page.screenshot({ path: shot("webinar-editor.png"), fullPage: true });
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  const preview = page.locator("[data-webinar-state]");
  await expect(preview.locator("[data-funnel-renderer]")).toHaveAttribute("data-viewport", "desktop");
  await expect(preview.getByRole("button", { name: "預覽模式，不送出報名", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "手機", exact: true }).click();
  await expect(preview.locator("[data-funnel-renderer]")).toHaveAttribute("data-viewport", "mobile");
  await page.getByRole("button", { name: "桌機", exact: true }).click();
  await expect(preview.locator("[data-funnel-renderer]")).toHaveAttribute("data-viewport", "desktop");
  await page.goto(`/lp/${slug}/registration`);
  await expect(page.getByRole("heading", { name: editedHeadline, exact: true })).toBeVisible();
  await expect(page.locator("[data-webinar-state]")).toHaveAttribute("data-webinar-state", "live");
  const attendeeEmail = `test-only-attendee-${suffix}@example.test`;
  const registration = page.locator('form[action="/api/form-submissions"]');
  await registration.getByLabel("姓名", { exact: true }).fill("TEST ONLY Webinar Attendee");
  await registration.getByLabel("Email", { exact: true }).fill(attendeeEmail);
  await registration.getByRole("button", { name: fixture.form.submitLabel, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/lp/${slug}/thank-you\\?submitted=verification_required$`, "u"));
  // A native redirect acknowledges receipt only; it must not mark an unverified email as verified.
  await expect.poll(async () => db.formSubmission.findFirst({
    where: { formId: fixture.form.id, liveId: fixture.live.id, email: attendeeEmail },
    select: { verificationStatus: true, verifiedAt: true },
  })).toEqual({ verificationStatus: "UNVERIFIED", verifiedAt: null });
  await page.getByRole("link", { name: "查看播放／重播頁", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/lp/${slug}/broadcast$`, "u"));
  await expect(page.getByRole("link", { name: /前往授權播放：/u })).toHaveAttribute("href", `/lp/${slug}/broadcast/play`);
  const handoff = await page.request.get(`/lp/${slug}/broadcast/play`, { maxRedirects: 0 });
  expect(handoff.status()).toBe(303);
  expect(new URL(handoff.headers().location, page.url()).pathname).toBe(`/live/${fixture.live.slug}`);
  for (const step of ["registration", "thank-you", "broadcast"]) {
    await page.goto(`/lp/${slug}/${step}`);
    await expect(page.locator("[data-funnel-renderer]")).toBeVisible();
    await page.reload();
    await expect(page.locator("[data-funnel-renderer]")).toBeVisible();
    await page.setViewportSize({ width: 375, height: 812 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: shot(`webinar-${step}-mobile.png`), fullPage: true });
    await page.setViewportSize({ width: 1280, height: 900 });
  }
  expect(errors).toEqual([]);
});
