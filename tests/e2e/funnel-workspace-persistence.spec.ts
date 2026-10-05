import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { Prisma, PrismaClient } from "@prisma/client";
import { createLandingPageFixture } from "../fixtures/landing-page";
import { assertLocalTestDatabase } from "../../scripts/local-database-safety";
import { createGoalFunnelStepPages } from "../../src/lib/funnel-goal-step-pages";
import { parseFunnelStepPages } from "../../src/lib/funnel-step-pages";

test.use({ trace: "off", screenshot: "off", video: "off" });
test("owner saves template, flow and popup through actual workspace and reloads scoped database content", async ({ page, browser, baseURL }) => {
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
    await page.goto(`/landing-pages/${row.id}`);
    await expect(page.getByLabel("Funnel steps", { exact: true })).toBeVisible();
    const initial = content.flow.steps.length;
    await page.getByRole("button", { name: "＋ 新增步驟", exact: true }).click();
    await expect(page.getByRole("button", { name: "流程 Undo", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(async () => (await read()).flow.steps.length).toBe(initial + 1);
    await expect(page.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
    await page.reload();
    await expect(page.getByLabel("Funnel steps", { exact: true })).toBeVisible();
    await page.getByLabel("Funnel steps", { exact: true }).getByRole("button", { name: "套用模板", exact: true }).first().click();
    await page.getByRole("button", { name: "Popups", exact: true }).last().click();
    await page.getByRole("button", { name: "＋ 新增", exact: true }).click();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(async () => { const draft = await read(); return draft.pages[draft.activeStepId].popups.length; }).toBe(1);
    const saved = await read();
    expect(saved.pages[saved.activeStepId].root.length).toBeGreaterThan(0);
    expect(saved.flow.steps.length).toBe(initial + 1);
    await page.reload();
    await expect(page.getByLabel("Funnel steps", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Popups", exact: true }).last().click();
    await expect(page.getByRole("button", { name: "刪除", exact: true })).toBeVisible();
    // A separately authenticated tenant must never open this persisted draft.
    const other = await otherContext.newPage();
    await other.goto(`${baseURL}/login`);
    await other.getByLabel("Email").fill(foreign.owner.email);
    await other.getByLabel("密碼").fill(foreign.password);
    await other.getByRole("button", { name: "登入", exact: true }).click();
    await expect(other).toHaveURL(/\/dashboard$/);
    await other.goto(`${baseURL}/landing-pages/${row.id}`);
    await expect(other.getByLabel("Funnel steps", { exact: true })).toHaveCount(0);
    expect(await read()).toEqual(saved);
  } finally {
    await otherContext.close();
    await db.vendor.deleteMany({ where: { id: { in: [fixture.vendor.id, foreign.vendor.id] } } });
    await db.user.deleteMany({ where: { id: { in: [fixture.owner.id, foreign.owner.id] } } });
    await db.$disconnect();
  }
});
