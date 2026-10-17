import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { Prisma, PrismaClient } from "@prisma/client";
import { createWebinarFunnelFixture } from "../fixtures/webinar-funnel";
import { createGoalFunnelStepPages } from "../../src/lib/funnel-goal-step-pages";
import { getFunnelTemplateGalleryItem } from "../../src/lib/funnel-template-gallery";
import { parseFunnelStepPages } from "../../src/lib/funnel-step-pages";
import type { FunnelNode } from "../../src/lib/funnel-page-document";

const db = new PrismaClient();
const run = randomUUID();
const ids = ["audience-course-workbook", "audience-course-consultation", "audience-course-lesson", "webinar-course-registration", "webinar-workshop-registration", "webinar-strategy-registration"];
const flatten = (nodes: FunnelNode[]): FunnelNode[] => nodes.flatMap(n => [n, ...flatten(n.children ?? [])]);
let fixture: Awaited<ReturnType<typeof createWebinarFunnelFixture>>;
const rows: Array<{ id: string; slug: string; template: string }> = [];

test.beforeAll(async () => {
  fixture = await createWebinarFunnelFixture(db, run);
  for (const [index, template] of ids.entries()) {
    const slug = `wp09-${run.slice(0, 8)}-${index}`;
    const content = createGoalFunnelStepPages({ id: `wp09_flow_${index}`, name: `WP09 synthetic ${index}`, domain: slug, goal: template.startsWith("webinar-") ? "webinar" : "audience" })!;
    if (content.flow.goal === "webinar") content.flow.webinar = { timezone: "Asia/Taipei", startsAt: "2030-08-01T02:00:00.000Z", endsAt: "2030-08-01T03:00:00.000Z", replayEndsAt: "2030-08-08T03:00:00.000Z" };
    const row = await db.landingPage.create({ data: { vendorId: fixture.vendor.id, projectId: fixture.project.id, name: content.flow.name, slug,
      draftContent: content as unknown as Prisma.InputJsonValue, draftFormId: fixture.form.id, draftLiveId: fixture.live.id,
    } });
    rows.push({ id: row.id, slug, template });
  }
});
test.afterAll(async () => { await db.$disconnect(); });

test("six sales/course templates apply through owner UI, publish and collect synthetic leads; desktop/mobile axe", async ({ page, baseURL }) => {
  test.setTimeout(300_000);
  page.setDefaultTimeout(20_000);
  const origin = new URL(baseURL!).origin;
  await page.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.setExtraHTTPHeaders({ "x-real-ip": "192.0.2.9", "x-forwarded-for": "192.0.2.9", "x-celebratedeal-live-chat-ingress": "wp09-owned-loopback-ingress-proof-20261016" });
  page.on("dialog", dialog => dialog.accept());
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(fixture.owner.email);
  await page.getByLabel("密碼", { exact: true }).fill(fixture.password);
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/u);
  for (const row of rows) {
    const template = getFunnelTemplateGalleryItem(row.template)!;
    await page.goto(`/landing-pages/${row.id}/operations`);
    const change = page.getByRole("button", { name: "更換模板", exact: true });
    if (row.template.startsWith("webinar-")) await change.click();
    const card = page.getByRole("article").filter({ has: page.getByText(template.name, { exact: true }) });
    await card.getByRole("button", { name: "套用模板", exact: true }).click();
    await expect.poll(async () => {
      const saved = parseFunnelStepPages((await db.landingPage.findUniqueOrThrow({ where: { id: row.id } })).draftContent)!;
      return saved.flow.steps[0]!.template.templateId;
    }).toBe(row.template);
    await page.goto(`/landing-pages/${row.id}`);
    await page.getByRole("button", { name: "頁面設定", exact: true }).click();
    await page.getByRole("button", { name: "發布已儲存草稿", exact: true }).click();
    await expect.poll(async () => (await db.landingPage.findUniqueOrThrow({ where: { id: row.id } })).publishedVersionId).not.toBeNull();
    expect((await page.goto(`/lp/${row.slug}`))?.status()).toBe(200);
    const title = flatten(template.build("assertion")).find(n => n.type === "headline" && n.props.level === "h1")!.props.text as string;
    await expect(page.getByRole("heading", { level: 1, name: title, exact: true })).toBeVisible();
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await expect.poll(() => page.title()).not.toBe("");
      const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
      expect(result.violations.filter(v => v.impact === "serious" || v.impact === "critical").map(v => ({ id: v.id, impact: v.impact }))).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
      await page.screenshot({ path: test.info().outputPath(`${row.template}-${width}.png`), fullPage: true });
    }
    const registration = page.locator('form[action="/api/form-submissions"]');
    if (row.template.startsWith("webinar-")) {
      await expect(page.getByText(/此 Funnel 尚未綁定可公開使用的報名表/u)).toHaveCount(0);
      await page.getByRole("link", { name: /報名(?:課程說明會|實作工作坊|服務提案講座)/u }).click();
      await expect(page).toHaveURL(/#webinar-registration$/u);
      await expect(page.locator("#webinar-registration")).toHaveCount(1);
      await expect(registration).toHaveAttribute("id", "webinar-registration");
    }
    await expect(registration.getByLabel(/^姓名\s*\*?$/u)).toHaveAttribute("required", "");
    await expect(registration.getByLabel(/^Email\s*\*?$/u)).toHaveAttribute("required", "");
    const email = `${row.template}-${run.slice(0, 8)}@example.test`;
    await registration.getByLabel(/^姓名\s*\*?$/u).fill("WP09 合成報名者");
    await registration.getByLabel(/^Email\s*\*?$/u).fill(email);
    if (!row.template.startsWith("webinar-")) await registration.getByRole("checkbox").check();
    await registration.getByRole("button", { name: fixture.form.submitLabel, exact: true }).click();
    await expect.poll(() => db.formSubmission.count({ where: { formId: fixture.form.id, liveId: fixture.live.id, email, verificationStatus: "UNVERIFIED", verifiedAt: null } })).toBe(1);
    // 寫入會早於完成頁導航；等原流程完成後再開啟下一款，避免兩次導航互相中止。
    // JS 送出會直接導向完成頁；只有原生 POST 才由伺服器附加 submitted query。
    await expect(page).toHaveURL(new RegExp(`/lp/${row.slug}/thank-you(?:\\?|$)`, "u"));
    await page.waitForLoadState("load");
    await page.setViewportSize({ width: 1280, height: 900 });
  }
});
