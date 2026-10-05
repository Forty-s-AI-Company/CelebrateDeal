import { expect, test, type Page } from "@playwright/test";

async function parentDocument(page: Page) {
  return JSON.parse(await page.getByTestId("parent-document").innerText());
}

test.describe("Funnel editor history lifecycle", () => {
  test("parent echoes retain undo and each Strict Mode edit emits once", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto("/browser-qa/funnel-editor");
    await page.getByRole("button", { name: "Section", exact: true }).click();
    await expect(page.getByTestId("change-count")).toHaveText("1");
    await page.getByRole("button", { name: "回傳相同文件" }).click();
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect.poll(async () => (await parentDocument(page)).root.length).toBe(0);
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await expect.poll(async () => (await parentDocument(page)).root.length).toBe(1);
    await expect(page.getByTestId("change-count")).toHaveText("3");
    expect(errors.filter((error) => /Cannot update a component|Maximum update depth/.test(error))).toEqual([]);
  });

  test("external replacement resets history and the next edit retains its settings", async ({ page }) => {
    await page.goto("/browser-qa/funnel-editor");
    await page.getByRole("button", { name: "Section", exact: true }).click();
    await page.getByRole("button", { name: "載入外部版本" }).click();
    await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Redo", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "頁面", exact: true }).click();
    await expect(page.getByLabel("SEO 標題", { exact: true })).toHaveValue("外部版本");
    await page.getByRole("button", { name: "Elements", exact: true }).click();
    await page.getByRole("button", { name: "Section", exact: true }).click();
    await expect.poll(async () => (await parentDocument(page)).root.length).toBe(1);
    expect((await parentDocument(page)).settings.seo.title).toBe("外部版本");
  });

  test("workspace persistence revision changes retain the current editor session", async ({ page }) => {
    await page.goto("/browser-qa/funnel-editor");
    await page.getByRole("button", { name: "Section", exact: true }).click();
    await page.getByRole("button", { name: "頁面", exact: true }).click();
    await page.getByRole("button", { name: "模擬儲存成功" }).click();
    await expect(page.getByTestId("persistence-revision")).toHaveText("2");
    await expect(page.getByLabel("SEO 標題", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect.poll(async () => (await parentDocument(page)).root.length).toBe(0);
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await expect.poll(async () => (await parentDocument(page)).root.length).toBe(1);
  });

  test("read-only blocks toolbar, keyboard and workspace undo commands", async ({ page }) => {
    await page.goto("/browser-qa/funnel-editor");
    await page.getByRole("button", { name: "Section", exact: true }).click();
    await page.getByRole("button", { name: "切換唯讀" }).click();
    await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
    await page.keyboard.press("Control+z");
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("celebratedeal:funnel-command", { detail: "undo" })));
    await expect(page.getByTestId("change-count")).toHaveText("1");
    expect((await parentDocument(page)).root).toHaveLength(1);
    await page.getByRole("button", { name: "切換唯讀" }).click();
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect.poll(async () => (await parentDocument(page)).root.length).toBe(0);
  });

  test("popup creation and deletion remain reversible after parent echoes", async ({ page }) => {
    await page.goto("/browser-qa/funnel-editor");
    await page.getByRole("button", { name: "Popups", exact: true }).click();
    await page.getByRole("button", { name: "＋ 新增", exact: true }).click();
    await expect.poll(async () => (await parentDocument(page)).popups.length).toBe(1);
    await page.getByRole("button", { name: "刪除", exact: true }).click();
    await expect.poll(async () => (await parentDocument(page)).popups.length).toBe(0);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect.poll(async () => (await parentDocument(page)).popups.length).toBe(1);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect.poll(async () => (await parentDocument(page)).popups.length).toBe(0);
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await expect.poll(async () => (await parentDocument(page)).popups.length).toBe(1);
  });
});

async function openFlow(page: Page) {
  await page.goto("/browser-qa/funnel-editor");
  await page.getByRole("button", { name: "測試多步驟流程", exact: true }).click();
  await expect(page.getByLabel("Funnel steps", { exact: true })).toBeVisible();
}
async function flowDocument(page: Page) {
  return JSON.parse(await page.getByTestId("flow-document").innerText());
}
test.describe("Delivered workspace multi-step flow", () => {
  test("add, echo, undo, redo and external replacement have one controlled update", async ({ page }) => {
    await openFlow(page);
    const initial = (await flowDocument(page)).flow.steps.length;
    await page.getByRole("button", { name: "＋ 新增步驟", exact: true }).click();
    await expect.poll(async () => (await flowDocument(page)).flow.steps.length).toBe(initial + 1);
    await expect(page.getByTestId("change-count")).toHaveText("1");
    await page.getByRole("button", { name: "回傳相同流程" }).click();
    await page.getByRole("button", { name: "流程 Undo", exact: true }).click();
    await expect.poll(async () => (await flowDocument(page)).flow.steps.length).toBe(initial);
    await page.getByRole("button", { name: "流程 Redo", exact: true }).click();
    await expect.poll(async () => (await flowDocument(page)).flow.steps.length).toBe(initial + 1);
    await page.getByRole("button", { name: "載入外部流程" }).click();
    await expect(page.getByRole("button", { name: "流程 Undo", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "流程 Redo", exact: true })).toBeDisabled();
    await expect.poll(async () => (await flowDocument(page)).flow.steps.length).toBe(initial);
  });
  test("canvas edit invalidates flow redo without losing its new content", async ({ page }) => {
    await openFlow(page);
    await page.getByRole("button", { name: "＋ 新增步驟", exact: true }).click();
    await page.getByRole("button", { name: "流程 Undo", exact: true }).click();
    await expect(page.getByRole("button", { name: "流程 Redo", exact: true })).toBeEnabled();
    const before = await flowDocument(page);
    const initial = before.pages[before.activeStepId].root.length;
    await page.getByRole("button", { name: "Section", exact: true }).click();
    await expect(page.getByRole("button", { name: "流程 Redo", exact: true })).toBeDisabled();
    await expect.poll(async () => {
      const doc = await flowDocument(page); return doc.pages[doc.activeStepId].root.length;
    }).toBe(initial + 1);
  });
  test("read-only mode blocks both step mutations and flow history", async ({ page }) => {
    await openFlow(page);
    await page.getByRole("button", { name: "＋ 新增步驟", exact: true }).click();
    const before = await page.getByTestId("flow-document").innerText();
    await page.getByRole("button", { name: "切換唯讀" }).click();
    await expect(page.getByRole("button", { name: "＋ 新增步驟", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "流程 Undo", exact: true })).toBeDisabled();
    await expect(page.getByLabel("步驟 URL Path", { exact: true })).toBeDisabled();
    await expect(page.getByTestId("flow-document")).toHaveText(before);
  });
});
