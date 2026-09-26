import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { Prisma, PrismaClient } from "@prisma/client";
import { parseFunnelStepPages } from "../../src/lib/funnel-step-pages";
import { assertLocalTestDatabase } from "../../scripts/local-database-safety";
import { createFunnelSalesProjectionFixture } from "../fixtures/funnel-operations";
import { createLandingPageFixture } from "../fixtures/landing-page";

const db = new PrismaClient();
const runKey = randomUUID();
let stage = "setup";
const diagnostics: { errors: string[]; actions: Array<{ stage: string; status: number; finished: boolean; milliseconds: number }>; failures: string[] } = { errors: [], actions: [], failures: [] };
let fixture: Awaited<ReturnType<typeof createLandingPageFixture>>;
test.use({ trace: "off", screenshot: "off", video: "off" });
test.beforeAll(async () => {
  assertLocalTestDatabase("DATABASE_URL", process.env.DATABASE_URL);
  fixture = await createLandingPageFixture(db, runKey);
});
test.afterAll(async () => { await db.$disconnect(); });
test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) return;
  const ruleState = await db.automationRule.findMany({ where: { vendorId: fixture.vendor.id }, select: { version: true, isActive: true } });
  const safe = { stage, errors: diagnostics.errors, actions: diagnostics.actions.slice(-8), failureCounts: diagnostics.failures.length, ruleState };
  console.log(`QA_DIAGNOSTIC ${JSON.stringify({ stage, errors: safe.errors, ruleState })}`);
  for (const action of safe.actions) console.log(`QA_DIAGNOSTIC ${JSON.stringify(action)}`);
  if (process.env.FUNNEL_OPERATIONS_QA_SCREENSHOT_DIR) writeFileSync(join(process.env.FUNNEL_OPERATIONS_QA_SCREENSHOT_DIR, "browser-diagnostics.json"), JSON.stringify(safe, null, 2));
  if (process.env.FUNNEL_OPERATIONS_QA_SCREENSHOT_DIR) await page.screenshot({ path: join(process.env.FUNNEL_OPERATIONS_QA_SCREENSHOT_DIR, "operations-failure.png"), fullPage: true }).catch(() => undefined);
});

test("Funnel secondary tabs persist settings and enforce the public deadline", async ({ page, baseURL }, testInfo) => {
  const origin = new URL(baseURL!).origin;
  expect(["127.0.0.1", "localhost"]).toContain(new URL(origin).hostname);
  page.setDefaultTimeout(20_000);
  const errors: string[] = [];
  page.on("pageerror", error => { errors.push(error.name); diagnostics.errors.push(`${stage}:${new URL(page.url()).pathname.replace(/\/landing-pages\/[^/]+/u, "/landing-pages/:id").replace(/\/lp\/[^/]+/u, "/lp/:slug")}:${error.message.match(/Minified React error #\d+/u)?.[0] ?? error.name}`); });
  const starts = new WeakMap<object, { stage: string; time: number }>();
  const observedActions = new WeakMap<object, (typeof diagnostics.actions)[number]>();
  page.on("requestfinished", request => { const item = observedActions.get(request); if (item) { item.finished = true; item.milliseconds = Date.now() - (starts.get(request)?.time ?? Date.now()); } });
  page.on("request", request => { if (request.method() === "POST") starts.set(request, { stage, time: Date.now() }); });
  page.on("response", response => {
    if (response.request().method() !== "POST" || new URL(response.url()).origin !== origin) return;
    const started = starts.get(response.request()) ?? { stage, time: Date.now() };
    const item = { stage: started.stage, status: response.status(), finished: false, milliseconds: 0 };
    diagnostics.actions.push(item);
    observedActions.set(response.request(), item);
  });
  page.on("requestfailed", request => { if (new URL(request.url()).origin === origin) diagnostics.failures.push(request.failure()?.errorText ?? "unknown"); });
  // Synthetic data only, and no external browser requests can leave the machine.
  await page.context().route(url => url.origin !== origin, route => route.request().url() === "https://rsms.me/inter/inter.css"
    ? route.fulfill({ status: 200, contentType: "text/css", body: "/* TEST ONLY offline font. */" })
    : route.abort("blockedbyclient"));
  await page.goto("/login");
  await page.getByLabel("Email").fill(fixture.owner.email);
  await page.getByLabel("密碼").fill(fixture.password);
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/u);
  await page.goto("/landing-pages/new");
  const slug = `test-only-operations-${runKey.replaceAll("-", "").slice(-12)}`;
  await page.getByRole("textbox", { name: "名稱 *", exact: true }).fill("TEST ONLY Operations Funnel");
  await page.getByRole("textbox", { name: /^Funnel 網址 \*/u }).fill(slug);
  await page.getByRole("button", { name: /建立名單/u }).click();
  await page.getByRole("button", { name: "儲存", exact: true }).click();
  await expect(page).toHaveURL(/\/landing-pages\/[^/?]+\/operations$/u);
  const operationsPath = new URL(page.url()).pathname;
  const pageId = operationsPath.split("/").at(-2)!;
  await page.getByRole("button", { name: "套用模板", exact: true }).first().click();
  await expect(page.getByRole("status").filter({ hasText: "模板已套用" })).toBeVisible();
  await page.getByRole("button", { name: "Edit Page", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/landing-pages/${pageId}\\?step=`, "u"));
  const editorPath = new URL(page.url()).pathname;
  await page.getByRole("button", { name: "頁面設定", exact: true }).click();
  await page.getByRole("combobox", { name: "預設報名表", exact: true }).selectOption(fixture.form.id);
  await page.getByRole("combobox", { name: "活動場次", exact: true }).selectOption(fixture.live.id);
  await page.getByRole("button", { name: "儲存草稿", exact: true }).click();
  await page.getByRole("button", { name: /返回 Configuration$/u }).click();
  await expect(page).toHaveURL(new RegExp(`${operationsPath.replaceAll("/", "\\/")}\\?step=`, "u"));
  await page.getByRole("button", { name: "Funnel settings", exact: true }).click();
  const panel = page.getByRole("region", { name: "Funnel 管理", exact: true });
  await expect(panel).toBeVisible();
  async function saveSettings() {
    const before = await db.landingPage.findUniqueOrThrow({ where: { id: pageId }, select: { revision: true } });
    await panel.getByRole("button", { name: "儲存設定", exact: true }).click();
    await expect(panel.getByRole("status").filter({ hasText: "設定已儲存。" })).toHaveText("設定已儲存。");
    await expect.poll(async () => (await db.landingPage.findUniqueOrThrow({ where: { id: pageId }, select: { revision: true } })).revision).toBe(before.revision + 1);
    const remainingSave = panel.getByRole("button", { name: "儲存設定", exact: true });
    await expect.poll(async () => (await remainingSave.count()) === 0 || await remainingSave.isDisabled()).toBe(true);
  }
  await panel.getByLabel("名稱", { exact: true }).fill("TEST ONLY Renamed Funnel");
  const changedSlug = `${slug}-edited`;
  await panel.getByLabel(/^Domain \/ slug/u).fill(changedSlug);
  await saveSettings();
  await expect.poll(async () => (await db.landingPage.findUniqueOrThrow({ where: { id: pageId } })).slug).toBe(changedSlug);
  await page.reload();
  await page.getByRole("button", { name: "Funnel settings", exact: true }).click();
  await expect(panel.getByLabel("名稱", { exact: true })).toHaveValue("TEST ONLY Renamed Funnel");
  await expect(panel.getByLabel(/^Domain \/ slug/u)).toHaveValue(changedSlug);
  await expect(panel.getByLabel(/^Currency/u)).toHaveValue("TWD");
  // Two actual browser editors load the same revision; the later stale write must fail.
  const stale = await page.context().newPage();
  await stale.goto(operationsPath);
  await stale.getByRole("button", { name: "Funnel settings", exact: true }).click();
  const stalePanel = stale.getByRole("region", { name: "Funnel 管理", exact: true });
  await expect(stalePanel.getByLabel("名稱", { exact: true })).toHaveValue("TEST ONLY Renamed Funnel");
  await panel.getByLabel("名稱", { exact: true }).fill("TEST ONLY Winning Revision");
  await saveSettings();
  await expect.poll(async () => (await db.landingPage.findUniqueOrThrow({ where: { id: pageId } })).name).toBe("TEST ONLY Winning Revision");
  await stalePanel.getByLabel("名稱", { exact: true }).fill("TEST ONLY Stale Revision");
  await stalePanel.getByRole("button", { name: "儲存設定", exact: true }).click();
  await expect(stalePanel.getByText(/版本衝突/u)).toBeVisible();
  expect((await db.landingPage.findUniqueOrThrow({ where: { id: pageId } })).name).toBe("TEST ONLY Winning Revision");
  stale.once("dialog", dialog => dialog.accept());
  await stalePanel.getByRole("button", { name: "重新載入", exact: true }).click();
  await expect(stalePanel.getByLabel("名稱", { exact: true })).toHaveValue("TEST ONLY Winning Revision");
  await stale.close();

  // Each report keeps its own filter; save/reload verifies the persisted model.
  for (const [tab, days] of [["Stats", 7], ["Leads", 14], ["Sales", 21]] as const) {
    await panel.getByRole("button", { name: tab, exact: true }).click();
    await panel.getByLabel("最近天數", { exact: true }).fill(String(days));
    await panel.getByRole("combobox", { name: /^報表步驟/u }).selectOption({ index: 1 });
    const selectedStep = await panel.getByRole("combobox", { name: /^報表步驟/u }).inputValue();
    await saveSettings();
    await expect(panel.getByRole("status").filter({ hasText: "設定已儲存。" })).toHaveText("設定已儲存。");
    await page.reload();
    await panel.getByRole("button", { name: tab, exact: true }).click();
    await expect(panel.getByLabel("最近天數", { exact: true })).toHaveValue(String(days));
    await expect(panel.getByRole("combobox", { name: /^報表步驟/u })).toHaveValue(selectedStep);
  }
  await panel.getByRole("button", { name: "A/B test", exact: true }).click();
  await panel.getByRole("button", { name: "建立 A/B 實驗", exact: true }).click();
  await panel.getByLabel("Control 權重", { exact: true }).fill("60");
  await panel.getByLabel("Variant 權重", { exact: true }).fill("40");
  await saveSettings();
  await expect(panel.getByRole("status").filter({ hasText: "設定已儲存。" })).toHaveText("設定已儲存。");
  await page.reload();
  await panel.getByRole("button", { name: "A/B test", exact: true }).click();
  await expect(panel.getByLabel("Control 權重", { exact: true })).toHaveValue("60");
  await expect(panel.getByLabel("Variant 權重", { exact: true })).toHaveValue("40");

  await page.goto(editorPath);
  await page.getByRole("button", { name: "發布已儲存草稿", exact: true }).click();
  await expect(page.getByRole("link", { name: /查看公開頁/u })).toBeVisible();
  await page.goto(operationsPath);
  await panel.getByRole("button", { name: "A/B test", exact: true }).click();
  await panel.getByRole("button", { name: "開始實驗", exact: true }).click();
  await saveSettings();
  await expect(panel.getByRole("status").filter({ hasText: "設定已儲存。" })).toHaveText("設定已儲存。");
  await page.reload();
  await panel.getByRole("button", { name: "A/B test", exact: true }).click();
  await expect(panel.getByLabel("Control 權重", { exact: true })).toBeDisabled();
  await expect(panel.getByRole("button", { name: "停止實驗", exact: true })).toBeVisible();

  const stored = await db.landingPage.findUniqueOrThrow({ where: { id: pageId } });
  const flow = parseFunnelStepPages(stored.draftContent)!.flow;
  const publicSteps = flow.steps.filter(step => !step.isSystem);
  expect(publicSteps.length).toBeGreaterThanOrEqual(2);
  const deadlineRedirectStep = publicSteps.at(-1)!;
  await page.goto(`/lp/${changedSlug}`);
  await page.reload();
  await expect.poll(() => db.funnelVisit.count({ where: { pageId, vendorId: fixture.vendor.id } })).toBeGreaterThanOrEqual(2);
  const observed = await db.funnelVisit.findMany({ where: { pageId, vendorId: fixture.vendor.id }, orderBy: { createdAt: "asc" } });
  expect(observed[0].visitorId).toBe(observed[1].visitorId);
  expect(observed[0].arm).toBe(observed[1].arm);
  expect(["control", "variant"]).toContain(observed[0].arm);
  await page.goto(operationsPath);
  await panel.getByRole("button", { name: "Stats", exact: true }).click();
  await panel.getByText("檢視來源事件 ID（前 20 筆）", { exact: true }).click();
  await expect(panel.getByText(observed[0].id, { exact: false })).toBeVisible();
  await panel.getByRole("button", { name: "A/B test", exact: true }).click();
  await panel.getByRole("button", { name: "停止實驗", exact: true }).click();
  await saveSettings();

  stage = "automation-list";
  await panel.getByRole("button", { name: "Automation Rules", exact: true }).click();
  const automation = page.getByRole("region", { name: "報名後自動化", exact: true });
  const createRule = automation.locator("form").filter({ has: page.getByRole("button", { name: "建立標籤規則", exact: true }) });
  await createRule.getByLabel("規則名稱", { exact: true }).fill("TEST ONLY Tag Rule");
  await createRule.getByLabel("客戶標籤", { exact: true }).fill("test-only-registered");
  stage = "automation-create";
  await createRule.getByRole("button", { name: "建立標籤規則", exact: true }).click();
  const rule = automation.getByRole("article");
  await expect(rule).toHaveCount(1);
  await page.reload();
  await panel.getByRole("button", { name: "Automation Rules", exact: true }).click();
  await expect(rule.getByLabel("規則名稱", { exact: true })).toHaveValue("TEST ONLY Tag Rule");
  await rule.getByLabel("客戶標籤", { exact: true }).fill("test-only-unsaved");
  await automation.getByRole("button", { name: "重新載入", exact: true }).click();
  await expect(rule.getByLabel("客戶標籤", { exact: true })).toHaveValue("test-only-registered");
  await rule.getByLabel("客戶標籤", { exact: true }).fill("test-only-updated");
  stage = "automation-update";
  await rule.getByRole("button", { name: "儲存變更", exact: true }).click();
  await expect(rule.getByRole("button", { name: "儲存變更", exact: true })).toBeEnabled();
  await rule.getByRole("button", { name: "停用規則", exact: true }).click();
  await expect(rule.getByText("已停用", { exact: true })).toBeVisible();
  await page.reload();
  await panel.getByRole("button", { name: "Automation Rules", exact: true }).click();
  await expect(rule.getByLabel("客戶標籤", { exact: true })).toHaveValue("test-only-updated");
  await expect(rule.getByRole("button", { name: "啟用規則", exact: true })).toBeVisible();

  await rule.getByRole("button", { name: "啟用規則", exact: true }).click();
  await expect(rule.getByRole("button", { name: "停用規則", exact: true })).toBeVisible();
  stage = "public-submission";
  await page.goto(`/lp/${changedSlug}`);
  await page.getByRole("textbox", { name: "姓名 *", exact: true }).fill("TEST ONLY Lead");
  await page.getByRole("textbox", { name: "Email *", exact: true }).fill(`lead-${runKey}@example.test`);
  const consent = page.getByRole("checkbox", { name: "我同意依本頁說明提交並使用上述資料。", exact: true });
  if (await consent.count()) await consent.check();
  const submitted = page.waitForResponse(response => response.url() === origin + "/api/form-submissions" && response.request().method() === "POST");
  await page.getByRole("button", { name: fixture.form.submitLabel, exact: true }).click();
  expect((await submitted).status()).toBe(200);
  // The successful form intentionally navigates; wait for that transition before leaving.
  await expect(page).toHaveURL(origin + `/lp/${changedSlug}/${publicSteps[1].path}`);
  await expect(page.locator("[data-funnel-renderer]")).toBeVisible();
  const attribution = await db.funnelSubmission.findFirstOrThrow({ where: { pageId, vendorId: fixture.vendor.id } });
  await expect.poll(() => db.customerTagAssignment.count({ where: { vendorId: fixture.vendor.id, tag: "test-only-updated" } })).toBe(1);
  await page.goto(operationsPath);
  await panel.getByRole("button", { name: "Leads", exact: true }).click();
  await expect(panel.getByRole("cell", { name: attribution.submissionId, exact: true })).toBeVisible();
  stage = "sales";
  const sale = await createFunnelSalesProjectionFixture(db, { vendorId: fixture.vendor.id, projectId: fixture.project.id, pageId, stepId: publicSteps[0].id, runKey });
  await page.reload();
  await panel.getByRole("button", { name: "Sales", exact: true }).click();
  await expect(panel.getByText(sale.orderNumber, { exact: true })).toBeVisible();
  await expect(panel.getByRole("cell", { name: "123400 / 23400", exact: true })).toBeVisible();
  await expect(panel.getByRole("cell", { name: sale.paymentId, exact: true })).toBeVisible();
  await expect(panel.getByText("TEST_ONLY_FAKE_PURCHASE", { exact: false })).toHaveCount(0);
  await expect(panel.locator("tbody tr")).toHaveCount(1);

  stage = "deadline";
  await panel.getByRole("button", { name: "Deadline settings", exact: true }).click();
  await panel.getByLabel("啟用截止時間", { exact: true }).check();
  await panel.getByLabel("時區", { exact: true }).fill("America/New_York");
  stage = "deadline-future";
  await panel.getByLabel(/^截止時間（含時區偏移）/u).fill("2099-01-01T00:00:00-05:00");
  await saveSettings();
  await page.goto(`/lp/${changedSlug}`);
  await expect(page.getByRole("textbox", { name: "姓名 *", exact: true })).toBeVisible();
  await page.goto(operationsPath);
  await panel.getByRole("button", { name: "Deadline settings", exact: true }).click();
  stage = "deadline-past";
  await panel.getByLabel(/^截止時間（含時區偏移）/u).fill("2000-01-01T00:00:00-05:00");
  await saveSettings();
  await expect(panel.getByRole("status").filter({ hasText: "設定已儲存。" })).toHaveText("設定已儲存。");
  await page.reload();
  await panel.getByRole("button", { name: "Deadline settings", exact: true }).click();
  await expect(panel.getByLabel("啟用截止時間", { exact: true })).toBeChecked();
  await expect(panel.getByLabel("時區", { exact: true })).toHaveValue("America/New_York");
  await expect(panel.getByLabel(/^截止時間（含時區偏移）/u)).toHaveValue("2000-01-01T00:00:00-05:00");
  await page.goto(`/lp/${changedSlug}`);
  await expect(page.getByRole("heading", { name: "此活動已截止", exact: true })).toBeVisible();
  await expect(page.locator("form")).toHaveCount(0);
  const denied = await page.request.post("/api/form-submissions", { headers: { origin, "x-celebratedeal-client": "web" }, data: { formId: fixture.form.id, liveId: fixture.live.id, landingPageId: pageId, funnelStepId: publicSteps[0].id, payload: { name: "TEST ONLY Expired", email: "expired@example.test" } } });
  expect(denied.status()).toBe(404);
  expect(await db.funnelSubmission.count({ where: { pageId } })).toBe(1);
  await page.goto(operationsPath);
  await panel.getByRole("button", { name: "Deadline settings", exact: true }).click();
  stage = "deadline-redirect";
  await panel.getByRole("combobox", { name: /^截止行為/u }).selectOption("redirect");
  await panel.getByRole("combobox", { name: /^過期導向/u }).selectOption(deadlineRedirectStep.path);
  await saveSettings();
  await page.goto(`/lp/${changedSlug}`);
  await expect(page).toHaveURL(origin + `/lp/${changedSlug}/${deadlineRedirectStep.path}`);
  await expect(page.locator("[data-funnel-renderer]")).toBeAttached();
  await expect(page.getByRole("heading", { name: "此活動已截止", exact: true })).toHaveCount(0);
  await page.goto(operationsPath);

  await expect(panel).toBeVisible();
  await page.getByRole("button", { name: "Funnel settings", exact: true }).click();
  await expect(panel.getByLabel("名稱", { exact: true })).toHaveValue("TEST ONLY Winning Revision");
  // This screenshot contains only synthetic test values; no trace/session export.
  await page.screenshot({ path: process.env.FUNNEL_OPERATIONS_QA_SCREENSHOT_DIR
    ? join(process.env.FUNNEL_OPERATIONS_QA_SCREENSHOT_DIR, "operations-settings.png")
    : testInfo.outputPath("operations-settings.png"), fullPage: true });

  // The real database must reject cross-tenant attribution, even if a caller bypasses UI.
  const foreign = await createLandingPageFixture(db, randomUUID());
  const ownPage = await db.landingPage.findUniqueOrThrow({ where: { id: pageId } });
  const foreignPage = await db.landingPage.create({ data: {
    vendorId: foreign.vendor.id, projectId: foreign.project.id, name: "TEST ONLY Foreign Funnel",
    slug: `test-only-foreign-${runKey}`, draftContent: ownPage.draftContent as Prisma.InputJsonValue,
  } });
  await expect(db.funnelVisit.create({ data: { vendorId: fixture.vendor.id, pageId: foreignPage.id, stepId: "test_step", logicalStepId: "test_step", visitorId: "test-only-visitor" } })).rejects.toMatchObject({ code: "P2003" });
  stage = "expected-foreign-unavailable";
  await page.goto(`/landing-pages/${foreignPage.id}/operations`);
  await expect(page.getByRole("heading", { name: "無法開啟 Funnel", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Funnel 管理", exact: true })).toHaveCount(0);
  await expect(page.getByText("TEST ONLY Foreign Funnel", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "返回 Funnel 列表", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
