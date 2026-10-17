import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { Prisma, PrismaClient } from "@prisma/client";
import { createLandingPageFixture } from "../fixtures/landing-page";
import { createGoalFunnelStepPages } from "../../src/lib/funnel-goal-step-pages";
import { defaultFunnelOperations } from "../../src/lib/funnel-operations";
import { assertLocalTestDatabase } from "../../scripts/local-database-safety";

const db = new PrismaClient();
test.use({ trace: "off", screenshot: "off", video: "off" });
test.afterAll(async () => { await db.$disconnect(); });

test("reads attributed current confirmation counts from PostgreSQL through the real merchant API and UI", async ({ page, baseURL }) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(20_000);
  assertLocalTestDatabase("DATABASE_URL", process.env.DATABASE_URL);
  let stage = "fixture";
  try {
  const origin = new URL(baseURL!).origin;
  expect(["localhost", "127.0.0.1"]).toContain(new URL(origin).hostname);
  await page.context().route(url => url.origin !== origin, route => route.abort("blockedbyclient"));
  // 與既有WP17 runner一致的合成本機proxy證明；不放寬來源信任規則。
  await page.setExtraHTTPHeaders({ "x-real-ip": "192.0.2.17", "x-forwarded-for": "192.0.2.17", "x-celebratedeal-live-chat-ingress": "wp17-owned-loopback-ingress-proof-20261016" });
  const run = randomUUID();
  const fixture = await createLandingPageFixture(db, run);
  const other = await createLandingPageFixture(db, randomUUID());
  const content = createGoalFunnelStepPages({ id: `wp14-${run}`, name: "WP14 合成統計", domain: `wp14-${run}`, goal: "webinar", currency: "TWD" })!;
  const stepId = content.flow.steps.find(step => !step.isSystem)!.id;
  // 講座內建模板已套用，才可操作報表分頁；不繞過既有模板閘門。
  expect(content.flow.steps.find(step => step.id === stepId)!.template.templateId).toBe("webinar-registration");
  const operations = defaultFunnelOperations();
  operations.reports.stats.days = 7;
  operations.reports.stats.stepId = stepId;
  // 純歷史歸因 fixture；不設定 running 實驗，也不發布公開頁。
  const funnel = await db.landingPage.create({ data: {
    vendorId: fixture.vendor.id, projectId: fixture.project.id, name: "WP14 合成統計", slug: `wp14-${run}`,
    draftContent: content as unknown as Prisma.InputJsonValue, operations: operations as unknown as Prisma.InputJsonValue,
  } });
  const now = Date.now();
  const inWindow = new Date(now - 60_000), outside = new Date(now - 10 * 86_400_000);
  async function visit(arm: string, createdAt: Date) {
    return db.funnelVisit.create({ data: { vendorId: fixture.vendor.id, pageId: funnel.id, stepId, logicalStepId: stepId, visitorId: randomUUID(), experimentId: "wp14-synthetic-experiment", arm, createdAt } });
  }
  const controlVisit = await visit("control", inWindow);
  const olderVariantVisit = await visit("variant", outside);
  async function registration(status: "VERIFIED" | "UNVERIFIED", visitId: string | null, createdAt = inWindow, formId = fixture.form.id) {
    const submission = await db.formSubmission.create({ data: { formId, name: "SYNTHETIC PRIVATE NAME", email: `wp14-${randomUUID()}@example.test`, verificationStatus: status, verifiedAt: status === "VERIFIED" ? new Date(now) : null, createdAt } });
    await db.funnelSubmission.create({ data: { vendorId: fixture.vendor.id, pageId: funnel.id, stepId, submissionId: submission.id, visitId, createdAt } });
    return submission.id;
  }
  const controlVerified = await registration("VERIFIED", controlVisit.id);
  await registration("UNVERIFIED", controlVisit.id);
  const variantPending = await registration("UNVERIFIED", olderVariantVisit.id);
  await registration("VERIFIED", null); // 無歸因不能灌入任一組。
  await registration("VERIFIED", controlVisit.id, outside); // 報名時間不在範圍內。
  await registration("VERIFIED", controlVisit.id, inWindow, other.form.id); // 錯誤來源表單必須排除。
  const before = { visits: await db.funnelVisit.count({ where: { pageId: funnel.id } }), submissions: await db.funnelSubmission.count({ where: { pageId: funnel.id } }) };

  stage = "login";
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(fixture.owner.email);
  await page.getByLabel("密碼", { exact: true }).fill(fixture.password);
  await page.getByRole("button", { name: "登入", exact: true }).click();
  try { await expect(page).toHaveURL(/\/dashboard$/u); }
  catch {
    // 僅白名單狀態與fixture計數；不輸出URL查詢、DOM、帳密或session內容。
    const location = new URL(page.url());
    const path = ["/login", "/dashboard", "/mfa/verify"].includes(location.pathname) ? location.pathname : "other";
    const value = location.searchParams.get("error");
    const error = ["1", "rate_limited", "temporarily_unavailable", "no_vendor", "mfa_required"].includes(value ?? "") ? value : "none";
    const sessions = await db.userSession.count({ where: { userId: fixture.owner.id } });
    const success = await db.auditLog.count({ where: { actorId: fixture.owner.id, action: "login_success" } });
    throw new Error(`Synthetic login state: ${JSON.stringify({ path, error, sessions, success })}`);
  }
  const path = `/landing-pages/${funnel.id}/operations`;
  stage = "operations-navigation";
  await page.goto(path);
  stage = "stats-tab";
  await page.getByRole("button", { name: "成效統計", exact: true }).click();
  stage = "readout-counts";
  const readout = page.getByRole("region", { name: "A/B 二次確認統計", exact: true });
  await expect(readout).toBeVisible();
  const control = readout.locator("p").filter({ hasText: "對照" });
  const variant = readout.locator("p").filter({ hasText: "測試" });
  await expect(control).toContainText("瀏覽次數 1 · 報名筆數 2 · 目前已確認筆數 1");
  await expect(variant).toContainText("瀏覽次數 0 · 報名筆數 1 · 目前已確認筆數 0");
  await expect(readout).toContainText("不受步驟篩選影響");
  await expect(readout).toContainText("期間結束後的確認");
  stage = "api-read";
  // 沿用產品實際的瀏覽器fetch/session，不另建Node請求或讀取Cookie。
  const response = await page.evaluate(async pageId => {
    const result = await fetch(`/api/funnel/operations/reports?pageId=${pageId}`, { credentials: "same-origin", cache: "no-store" });
    const contentType = result.headers.get("content-type");
    return { status: result.status, cacheControl: result.headers.get("cache-control"), contentType, report: contentType?.includes("application/json") ? await result.json() : null };
  }, funnel.id);
  expect(response.status).toBe(200);
  expect(response.cacheControl).toContain("no-store");
  expect(response.contentType).toContain("application/json");
  const report = response.report;
  expect(report.experiments).toEqual([
    { id: "wp14-synthetic-experiment", arm: "control", pageViews: 1, submissions: 2, verifiedSubmissions: 1 },
    { id: "wp14-synthetic-experiment", arm: "variant", pageViews: 0, submissions: 1, verifiedSubmissions: 0 },
  ]);
  expect(JSON.stringify(report)).not.toMatch(/SYNTHETIC PRIVATE NAME|@example\.test/u);
  expect(report.statsTruncated).toBe(false);
  stage = "readout-axe-screenshots";
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const axe = await new AxeBuilder({ page }).include('[aria-label="A/B 二次確認統計"]').analyze();
    expect(axe.violations.filter(item => item.impact === "serious" || item.impact === "critical")).toEqual([]);
    await readout.screenshot({ path: `docs/ai-team/evidence/product-audit-20261011/WP-14/ab-readout-${width}.png` });
  }
  // 狀態改變只模擬既有確認結果，不宣稱本測試走了確認 token 流程。
  stage = "current-status-refresh";
  await db.formSubmission.update({ where: { id: variantPending }, data: { verificationStatus: "VERIFIED", verifiedAt: new Date() } });
  await page.reload();
  await page.getByRole("button", { name: "成效統計", exact: true }).click();
  await expect(variant).toContainText("瀏覽次數 0 · 報名筆數 1 · 目前已確認筆數 1");
  stage = "read-invariants";
  expect((await db.formSubmission.findUniqueOrThrow({ where: { id: controlVerified } })).verificationStatus).toBe("VERIFIED");
  expect({ visits: await db.funnelVisit.count({ where: { pageId: funnel.id } }), submissions: await db.funnelSubmission.count({ where: { pageId: funnel.id } }) }).toEqual(before);
  expect((await db.landingPage.findUniqueOrThrow({ where: { id: funnel.id } })).operations).toEqual(operations);
  expect(await db.emailDelivery.count({ where: { vendorId: fixture.vendor.id } })).toBe(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("Synthetic login state:")) throw error;
    const kind = ["net::ERR_ABORTED", "toHaveURL", "toContainText", "toEqual", "toBe", "Timeout", "Target page"].find(item => message.includes(item)) ?? "OTHER";
    // URL/能力資料一律不保存，只輸出固定階段與錯誤類別。
    throw new Error(`Synthetic readout failure: ${JSON.stringify({ stage, kind })}`);
  }
});
