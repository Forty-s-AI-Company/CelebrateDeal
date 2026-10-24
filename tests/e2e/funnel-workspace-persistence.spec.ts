import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { Prisma, PrismaClient } from "@prisma/client";
import { createLandingPageFixture } from "../fixtures/landing-page";
import { assertLocalTestDatabase } from "../../scripts/local-database-safety";
import { createGoalFunnelStepPages } from "../../src/lib/funnel-goal-step-pages";
import { parseFunnelStepPages } from "../../src/lib/funnel-step-pages";

test.use({ trace: "off", screenshot: "off", video: "off" });
// This journey includes two logins, a save, reloads and inspector edits.
test.setTimeout(120_000);
test("owner saves canvas actions and popup through the full-screen editor and reloads scoped database content", async ({ page, browser, baseURL }) => {
  assertLocalTestDatabase("DATABASE_URL", process.env.DATABASE_URL);
  const db = new PrismaClient();
  const fixture = await createLandingPageFixture(db, randomUUID());
  const foreign = await createLandingPageFixture(db, randomUUID());
  const content = createGoalFunnelStepPages({ id: "test_flow", name: "合成流程驗收", domain: `flow-${randomUUID()}`, goal: "audience" })!;
  const row = await db.landingPage.create({ data: { vendorId: fixture.vendor.id, projectId: fixture.project.id, name: content.flow.name, slug: content.flow.domain, draftContent: content as unknown as Prisma.InputJsonValue } });
  const otherContext = await browser.newContext();
  page.on("dialog", (dialog) => dialog.accept());
  await page.context().route((url) => url.origin !== new URL(baseURL!).origin, (route) => route.abort());
  const read = async () => parseFunnelStepPages((await db.landingPage.findUniqueOrThrow({ where: { id: row.id } })).draftContent)!;
  try {
    await page.goto("/login");
    await page.getByLabel("Email").fill(fixture.owner.email);
    await page.getByLabel("密碼").fill(fixture.password);
    await page.getByRole("button", { name: "登入", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    // The old editor URL redirects to the full-screen editor and keeps the step.
    const stepId = content.flow.steps[0].id;
    await page.goto(`/landing-pages/${row.id}?step=${encodeURIComponent(stepId)}`);
    await expect(page).toHaveURL(new RegExp(`/landing-pages/${row.id}/edit\\?step=${stepId}$`, "u"));
    const toolbar = page.getByLabel("編輯器工具列", { exact: true });
    await expect(toolbar).toBeVisible();
    // Step management lives on the management page, not in the editor.
    await expect(page.getByLabel("網站步驟", { exact: true })).toHaveCount(0);
    const initial = content.flow.steps.length;
    await page.getByRole("button", { name: "區段", exact: true }).click();
    await page.getByRole("button", { name: "欄列", exact: true }).click();
    await page.getByRole("button", { name: "按鈕", exact: true }).click();
    await page.getByRole("navigation", { name: "目前選取位置" }).getByRole("button", { name: "選取按鈕", exact: true }).click();
    await page.getByRole("button", { name: "動作", exact: true }).click();
    await page.getByLabel("點擊後動作").selectOption("next_step");
    const targetStepId = content.flow.steps[1].id;
    await page.locator("label").filter({ hasText: /^下一個步驟/u }).locator("select").selectOption(targetStepId);
    await page.getByRole("button", { name: "套用動作", exact: true }).click();
    await toolbar.getByRole("button", { name: "彈出視窗", exact: true }).click();
    await page.getByRole("button", { name: "＋ 新增", exact: true }).click();
    await toolbar.getByRole("button", { name: "儲存", exact: true }).click();
    await expect.poll(async () => { const draft = await read(); return draft.pages[draft.activeStepId].popups.length; }).toBe(1);
    await expect(toolbar.getByRole("button", { name: "已儲存", exact: true })).toBeDisabled();
    const saved = await read();
    expect(saved.pages[saved.activeStepId].root.length).toBeGreaterThan(0);
    expect(JSON.stringify(saved.pages[saved.activeStepId].root)).toContain(`"stepId":"${targetStepId}"`);
    expect(saved.flow.steps.length).toBe(initial);
    await page.reload();
    await expect(toolbar).toBeVisible();
    await toolbar.getByRole("button", { name: "彈出視窗", exact: true }).click();
    await expect(page.getByRole("button", { name: "刪除", exact: true })).toBeVisible();
    // Leaving a clean editor returns to the management page for the same step.
    await toolbar.getByRole("button", { name: "離開", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/landing-pages/${row.id}/operations\\?step=${stepId}&tab=configuration$`, "u"));
    // A separately authenticated tenant must never open this persisted draft.
    const other = await otherContext.newPage();
    await other.goto(`${baseURL}/login`);
    await other.getByLabel("Email").fill(foreign.owner.email);
    await other.getByLabel("密碼").fill(foreign.password);
    await other.getByRole("button", { name: "登入", exact: true }).click();
    await expect(other).toHaveURL(/\/dashboard$/);
    await other.goto(`${baseURL}/landing-pages/${row.id}/edit`);
    await expect(other.getByLabel("編輯器工具列", { exact: true })).toHaveCount(0);
    await other.goto(`${baseURL}/landing-pages/${row.id}`);
    await expect(other.getByLabel("編輯器工具列", { exact: true })).toHaveCount(0);
    expect(await read()).toEqual(saved);
  } finally {
    await otherContext.close();
    await db.vendor.deleteMany({ where: { id: { in: [fixture.vendor.id, foreign.vendor.id] } } });
    await db.user.deleteMany({ where: { id: { in: [fixture.owner.id, foreign.owner.id] } } });
    await db.$disconnect();
  }
});
