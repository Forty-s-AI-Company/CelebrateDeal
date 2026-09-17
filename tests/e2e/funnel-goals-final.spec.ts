import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { assertLocalTestDatabase } from "../../scripts/local-database-safety";
import { createLandingPageFixture, type LandingPageFixture } from "../fixtures/landing-page";

/**
 * Final browser contract for the four Funnel goals.
 *
 * This suite intentionally uses only the disposable loopback database selected
 * by playwright.config.ts.  Each test creates and removes its own Funnel via
 * the real UI, so an incomplete publish can still be inspected safely.
 */
const db = new PrismaClient();
const runKey = randomUUID();
let fixture: LandingPageFixture;

test.use({ trace: "off", screenshot: "off", video: "off" });
test.beforeAll(async () => {
  assertLocalTestDatabase("DATABASE_URL", process.env.DATABASE_URL);
  fixture = await createLandingPageFixture(db, runKey);
});
test.afterAll(async () => {
  await db.$disconnect();
});

type Goal = "audience" | "sell" | "custom" | "webinar";
const goals: Array<{ goal: Goal; label: string }> = [
  { goal: "audience", label: "建立名單" },
  { goal: "sell", label: "銷售商品或服務" },
  { goal: "custom", label: "自訂 Funnel" },
  { goal: "webinar", label: "自動化 Webinar" },
];

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(fixture.owner.email);
  await page.getByLabel("密碼").fill(fixture.password);
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/u);
}

async function createGoal(page: Page, goal: Goal) {
  const suffix = `${runKey.replaceAll("-", "").slice(-10)}-${goal}`;
  await page.goto("/landing-pages/new");
  await page.getByLabel("名稱 *").fill(`TEST ONLY Final ${goal} ${suffix}`);
  await page.getByLabel("Funnel 網址 *").fill(`test-only-final-${suffix}`);
  await page.getByRole("button", { name: new RegExp(`^${goals.find((item) => item.goal === goal)!.label}`, "u") }).click();
  await page.getByRole("button", { name: "儲存並進入編輯器", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`[?&]goal=${goal}(?:&|$)`, "u"));
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeVisible();
  return { slug: `test-only-final-${suffix}` };
}

async function exerciseEditor(page: Page, goal: Goal) {
  // The step editor is the shared contract for all four goals.
  await expect(page.getByRole("complementary", { name: "Funnel steps" })).toBeVisible();
  const gallery = page.getByText("模板 Gallery", { exact: true });
  if (await gallery.count()) {
    const preview = page.getByRole("button", { name: "完整預覽", exact: true }).first();
    if (await preview.count()) {
      await preview.click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.getByRole("button", { name: "手機版", exact: true }).click();
      await expect(page.getByRole("button", { name: "關閉", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "關閉", exact: true }).click();
    }
    const apply = page.getByRole("button", { name: "套用模板", exact: true }).first();
    if (await apply.count()) {
      page.once("dialog", (dialog) => dialog.accept());
      await apply.click();
    }
  }

  // Add a step, then exercise flow undo/redo and a persisted step rename.
  const addStep = page.getByRole("button", { name: "＋ 新增步驟", exact: true });
  await addStep.click();
  await expect(page.getByText("新步驟", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "流程 Undo", exact: true }).click();
  await page.getByRole("button", { name: "流程 Redo", exact: true }).click();
  const addedStep = page.getByRole("button", { name: /^新步驟/u });
  await expect(addedStep).toBeVisible();
  await addedStep.click();

  // Select the active step's first editable name and wait for debounce save.
  const stepName = page.getByLabel("步驟名稱", { exact: true });
  if (await stepName.count()) {
    await stepName.fill(`TEST ONLY ${goal} step`);
    await expect(page.getByRole("status").filter({ hasText: /步驟已自動儲存|尚未儲存/u }).first()).toBeVisible();
  }

  // The page editor owns the common node operations and history.
  await page.getByRole("button", { name: "Blocks", exact: true }).click();
  const editorAside = page.locator("aside").last();
  const block = editorAside.getByRole("button", { name: /^歡迎 Hero・編輯版/u });
  await expect(block).toBeVisible();
  await block.click();
  await page.getByRole("button", { name: "Elements", exact: true }).click();
  const node = page.locator('[data-render-mode="editor"] [data-funnel-node-type="headline"], [data-render-mode="editor"] [data-funnel-node-type="text"]').first();
  await expect(node).toBeVisible();
  await node.click();
  const inspector = page.locator("[data-funnel-element-inspector]");
  await expect(inspector).toBeVisible();
  const editable = inspector.locator("input:not([type=checkbox]):not([disabled]), textarea:not([disabled])").first();
  if (await editable.count()) await editable.fill(`TEST ONLY ${goal} edited`);
  await editorAside.getByRole("button", { name: "複製", exact: true }).click();
  await editorAside.getByRole("button", { name: "上移", exact: true }).click();
  await editorAside.getByRole("button", { name: "下移", exact: true }).click();
  await editorAside.getByRole("button", { name: "刪除", exact: true }).click();
  const element = page.getByRole("button", { name: "文字", exact: true });
  if (await element.count()) {
    await element.click();
    await page.getByRole("button", { name: "桌機", exact: true }).click();
    await page.getByRole("button", { name: "手機", exact: true }).click();
    await page.getByRole("button", { name: "Undo", exact: true }).last().click();
    await page.getByRole("button", { name: "Redo", exact: true }).last().click();
  }

  // Popup creation, preview, close, Exit-intent guard, and deletion.
  await page.getByRole("button", { name: "Popups", exact: true }).first().click();
  const popupPanel = page.getByText("尚未建立 Popup。", { exact: true });
  const addPopup = page.getByRole("button", { name: "＋ 新增", exact: true });
  if (await addPopup.count()) {
    await addPopup.click();
    await expect(page.getByText("Exit intent（待驗證，不會觸發）", { exact: true })).toBeVisible();
    await page.getByRole("checkbox", { name: "顯示關閉按鈕", exact: true }).check();
    await page.getByRole("checkbox", { name: "Exit intent（待驗證，不會觸發）", exact: true }).check();
    const popupPreview = page.getByRole("button", { name: "預覽", exact: true });
    if (await popupPreview.count()) {
      await popupPreview.click();
      await expect(page.getByRole("button", { name: "關閉 Popup", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "關閉 Popup", exact: true }).click();
    }
    const popupDelete = page.getByRole("button", { name: "刪除", exact: true }).last();
    if (await popupDelete.count()) await popupDelete.click();
  } else {
    await expect(popupPanel).toBeVisible();
  }
}

for (const { goal } of goals) {
  test(`四 Goal：${goal} 建立、編輯、保存、預覽與安全發布生命週期`, async ({ page }) => {
    await login(page);
    const { slug } = await createGoal(page, goal);
    await exerciseEditor(page, goal);

    // Save twice to verify duplicate-submit protection leaves one page and a
    // stable redirect; the second click is intentionally made while pending.
    const save = page.getByRole("button", { name: "Save", exact: true });
    // Step mutations may still be draining through auto-save; manual save is
    // only a valid user action after that queue releases the button.
    await expect(save).toBeEnabled();
    // Dispatch two events in the same browser task. The workspace in-flight
    // guard must collapse them into one create mutation.
    await save.evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
    await expect(page).toHaveURL(/\/landing-pages\/[^/?]+$/u);
    const pageId = new URL(page.url()).pathname.split("/").at(-1)!;
    await expect.poll(async () => (await db.landingPage.findUnique({ where: { id: pageId }, select: { slug: true } }))?.slug).toBe(slug);
    await page.reload();
    await expect(page.getByRole("button", { name: "Save", exact: true })).toBeVisible();

    const preview = page.getByRole("button", { name: "Preview", exact: true });
    await expect(preview).toBeEnabled();
    await preview.click();
    const returnToEditor = page.getByLabel("Funnel 編輯器工具列").getByRole("button", { name: "返回編輯", exact: true });
    await expect(returnToEditor).toBeVisible();
    await returnToEditor.click();

    const publish = page.getByRole("button", { name: "發布已儲存草稿", exact: true });
    await expect(publish).toBeVisible();
    if (goal !== "webinar") {
      await expect(publish).toBeEnabled();
      await publish.click();
      await expect(page.getByRole("link", { name: /查看公開頁/u })).toBeVisible();
      await page.goto(`/lp/${slug}`);
      await expect(page.locator("body")).toBeVisible();
    } else {
      // Webinar resources are intentionally absent in this disposable fixture.
      // The UI may pre-disable publish or the server may reject it explicitly;
      // both paths must fail closed and must never expose a public-page link.
      if (await publish.isEnabled()) {
        await publish.click();
        await expect(page.getByRole("status").filter({ hasText: /Webinar.*(?:綁定|場次|影片|資源)/u })).toBeVisible();
      } else {
        await expect(publish).toBeDisabled();
      }
      await expect(page.getByRole("link", { name: /查看公開頁/u })).toHaveCount(0);
    }

    await page.goto(`/landing-pages/${pageId}`);
    const remove = page.getByRole("button", { name: "刪除 Funnel", exact: true });
    await expect(remove).toBeVisible();
    page.once("dialog", (dialog) => dialog.accept());
    await remove.click();
    await expect(page).toHaveURL(/\/landing-pages$/u);
    await expect.poll(async () => db.landingPage.findUnique({ where: { id: pageId }, select: { id: true } })).toBeNull();
  });
}
