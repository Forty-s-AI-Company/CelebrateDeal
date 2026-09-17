import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { assertLocalTestDatabase } from "../../scripts/local-database-safety";
import { createLandingPageFixture, type LandingPageFixture } from "../fixtures/landing-page";

/**
 * Browser contract for the systeme-style Funnel journey:
 * create -> goal-filtered template -> Configuration -> Edit Page -> return.
 */
const db = new PrismaClient();
const runKey = randomUUID();
let fixture: LandingPageFixture;

test.use({ trace: "off", screenshot: "off", video: "off" });
test.setTimeout(120_000);
test.beforeAll(async () => {
  assertLocalTestDatabase("DATABASE_URL", process.env.DATABASE_URL);
  fixture = await createLandingPageFixture(db, runKey);
});
test.afterAll(async () => { await db.$disconnect(); });

type Goal = "audience" | "sell" | "custom" | "webinar";
const goals: Array<{ goal: Goal; label: string }> = [
  { goal: "audience", label: "建立名單" },
  { goal: "sell", label: "銷售商品或服務" },
  { goal: "custom", label: "自訂 Funnel" },
  { goal: "webinar", label: "自動化 Webinar" },
];
const operationsTabs = ["Configuration", "Automation Rules", "A/B test", "Stats", "Leads", "Sales", "Deadline settings"];

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(fixture.owner.email);
  await page.getByLabel("密碼").fill(fixture.password);
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/u);
}

async function createGoal(page: Page, goal: Goal) {
  const suffix = `${runKey.replaceAll("-", "").slice(-10)}-${goal}`;
  const slug = `test-only-final-${suffix}`;
  await page.goto("/landing-pages");
  await expect(page.getByRole("heading", { name: "Funnels", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "建立 Funnel", exact: true }).first().click();
  await expect(page).toHaveURL(/\/landing-pages\/new$/u);
  await page.getByLabel("名稱 *").fill(`TEST ONLY Final ${goal} ${suffix}`);
  await page.getByLabel("Funnel 網址 *").fill(slug);
  await page.getByRole("button", { name: new RegExp(`^${goals.find((item) => item.goal === goal)!.label}`, "u") }).click();
  await page.getByRole("button", { name: "儲存", exact: true }).click();
  await expect(page).toHaveURL(/\/landing-pages\/[^/?]+\/operations$/u);
  const pageId = new URL(page.url()).pathname.split("/").at(-2)!;

  const management = page.getByRole("region", { name: "Funnel 管理", exact: true });
  await expect(management).toBeVisible();
  for (const tab of operationsTabs) await expect(management.getByRole("button", { name: tab, exact: true })).toBeVisible();

  if (goal === "custom") {
    await expect(management.getByRole("heading", { name: "尚未建立 Funnel step", exact: true })).toBeVisible();
    await management.getByRole("button", { name: "Add step", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Add step", exact: true });
    await dialog.getByLabel("名稱 *", { exact: true }).fill("TEST ONLY Custom Page");
    await dialog.getByLabel("URL Path *", { exact: true }).fill("custom-page");
    await dialog.getByLabel("從空白開始", { exact: true }).check();
    await dialog.getByRole("button", { name: "儲存", exact: true }).click();
    await expect(management.getByRole("status")).toContainText("新步驟已建立");
    await expect(management.getByRole("button", { name: "Edit Page", exact: true })).toBeEnabled();
  } else if (goal === "audience" || goal === "sell") {
    await expect(management.getByRole("heading", { name: /選擇模板/u })).toBeVisible();
    await management.getByRole("button", { name: "套用模板", exact: true }).first().click();
    await expect(management.getByRole("status")).toContainText("模板已套用");
    await expect(management.getByRole("button", { name: "Edit Page", exact: true })).toBeEnabled();
  }

  await management.getByRole("button", { name: "Edit Page", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/landing-pages/${pageId}\\?step=`, "u"));
  await expect(page.getByLabel("Funnel 編輯器工具列", { exact: true })).toBeVisible();
  return { slug, pageId };
}

for (const { goal } of goals) {
  test(`四 Goal：${goal} 依序經過管理、模板與單頁編輯器`, async ({ page }) => {
    await login(page);
    const { slug, pageId } = await createGoal(page, goal);
    const toolbar = page.getByLabel("Funnel 編輯器工具列", { exact: true });

    await expect(toolbar.getByRole("button", { name: "Save", exact: true })).toBeVisible();
    await toolbar.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: /草稿已儲存|已儲存/u }).first()).toBeVisible();
    await expect.poll(async () => (await db.landingPage.findUnique({ where: { id: pageId }, select: { slug: true } }))?.slug).toBe(slug);

    await toolbar.getByRole("button", { name: /返回 Configuration$/u }).click();
    await expect(page).toHaveURL(new RegExp(`/landing-pages/${pageId}/operations\\?step=`, "u"));
    const management = page.getByRole("region", { name: "Funnel 管理", exact: true });
    await expect(management.getByRole("button", { name: "Configuration", exact: true })).toBeVisible();
    await management.getByRole("button", { name: "Automation Rules", exact: true }).click();
    await expect(page.getByRole("region", { name: "報名後自動化", exact: true })).toBeVisible();

    await management.getByRole("button", { name: "Configuration", exact: true }).click();
    await management.getByRole("button", { name: "Edit Page", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/landing-pages/${pageId}\\?step=`, "u"));
    const publish = page.getByRole("button", { name: "發布已儲存草稿", exact: true });
    if (goal !== "webinar") {
      await expect(publish).toBeEnabled();
      await publish.click();
      await expect(page.getByRole("link", { name: /查看公開頁/u })).toBeVisible();
    } else {
      if (await publish.isEnabled()) await publish.click();
      await expect(page.getByRole("link", { name: /查看公開頁/u })).toHaveCount(0);
    }

    const remove = page.getByRole("button", { name: "刪除 Funnel", exact: true });
    page.once("dialog", (dialog) => dialog.accept());
    await remove.click();
    await expect(page).toHaveURL(/\/landing-pages$/u);
    await expect.poll(async () => db.landingPage.findUnique({ where: { id: pageId }, select: { id: true } })).toBeNull();
  });
}
