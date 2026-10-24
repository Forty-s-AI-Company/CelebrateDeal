import { expect, test, type Page } from "@playwright/test";

async function parentDocument(page: Page) {
  return JSON.parse(await page.getByTestId("parent-document").innerText());
}
// Palette tiles are named by their visible label; toolbar buttons by aria-label.
const palette = (page: Page, name: string) => page.getByRole("button", { name, exact: true });

test.describe("Funnel editor history lifecycle", () => {
  test("rejected outer parent changes never create ghost canvas or history", async ({ page }) => {
    await page.goto("/browser-qa/funnel-editor");
    await page.getByRole("button", { name: "切換拒絕修改" }).click();
    await palette(page, "區段").click();
    expect((await parentDocument(page)).root).toHaveLength(0);
    await expect(page.getByRole("button", { name: "復原", exact: true })).toBeDisabled();
    await expect(page.getByTestId("change-count")).toHaveText("0");
    await page.getByRole("button", { name: "切換拒絕修改" }).click();
    await palette(page, "區段").click();
    await expect.poll(async () => (await parentDocument(page)).root.length).toBe(1);
    await page.getByRole("button", { name: "復原", exact: true }).click();
    await expect.poll(async () => (await parentDocument(page)).root.length).toBe(0);
  });
  test("parent echoes retain undo and each Strict Mode edit emits once", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto("/browser-qa/funnel-editor");
    await palette(page, "區段").click();
    await expect(page.getByTestId("change-count")).toHaveText("1");
    await page.getByRole("button", { name: "回傳相同文件" }).click();
    await page.getByRole("button", { name: "復原", exact: true }).click();
    await expect.poll(async () => (await parentDocument(page)).root.length).toBe(0);
    await page.getByRole("button", { name: "重做", exact: true }).click();
    await expect.poll(async () => (await parentDocument(page)).root.length).toBe(1);
    await expect(page.getByTestId("change-count")).toHaveText("3");
    expect(errors.filter((error) => /Cannot update a component|Maximum update depth/.test(error))).toEqual([]);
  });

  test("external replacement resets history and the next edit retains its settings", async ({ page }) => {
    await page.goto("/browser-qa/funnel-editor");
    await palette(page, "區段").click();
    await page.getByRole("button", { name: "載入外部版本" }).click();
    await expect(page.getByRole("button", { name: "復原", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "重做", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "頁面設定", exact: true }).click();
    await expect(page.getByLabel("搜尋引擎標題", { exact: true })).toHaveValue("外部版本");
    await page.getByRole("complementary", { name: "編輯面板" }).getByRole("button", { name: "返回", exact: true }).click();
    await expect(page.getByRole("tab", { name: "元件", exact: true })).toHaveAttribute("aria-selected", "true");
    await palette(page, "區段").click();
    await expect.poll(async () => (await parentDocument(page)).root.length).toBe(1);
    expect((await parentDocument(page)).settings.seo.title).toBe("外部版本");
  });

  test("workspace persistence revision changes retain the current editor session", async ({ page }) => {
    await page.goto("/browser-qa/funnel-editor");
    await palette(page, "區段").click();
    await page.getByRole("button", { name: "頁面設定", exact: true }).click();
    await page.getByRole("button", { name: "模擬儲存成功" }).click();
    await expect(page.getByTestId("persistence-revision")).toHaveText("2");
    await expect(page.getByLabel("搜尋引擎標題", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "復原", exact: true }).click();
    await expect.poll(async () => (await parentDocument(page)).root.length).toBe(0);
    await page.getByRole("button", { name: "重做", exact: true }).click();
    await expect.poll(async () => (await parentDocument(page)).root.length).toBe(1);
  });

  test("read-only blocks toolbar, keyboard and workspace undo commands", async ({ page }) => {
    await page.goto("/browser-qa/funnel-editor");
    await palette(page, "區段").click();
    await page.getByRole("button", { name: "切換唯讀" }).click();
    await expect(page.getByRole("button", { name: "復原", exact: true })).toBeDisabled();
    await expect(palette(page, "區段")).toBeDisabled();
    await page.keyboard.press("Control+z");
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("celebratedeal:funnel-command", { detail: "undo" })));
    await expect(page.getByTestId("change-count")).toHaveText("1");
    expect((await parentDocument(page)).root).toHaveLength(1);
    await page.getByRole("button", { name: "切換唯讀" }).click();
    await page.getByRole("button", { name: "復原", exact: true }).click();
    await expect.poll(async () => (await parentDocument(page)).root.length).toBe(0);
  });

  test("popup creation and deletion remain reversible after parent echoes", async ({ page }) => {
    await page.goto("/browser-qa/funnel-editor");
    await page.getByRole("button", { name: "彈出視窗", exact: true }).click();
    await page.getByRole("button", { name: "＋ 新增", exact: true }).click();
    await expect.poll(async () => (await parentDocument(page)).popups.length).toBe(1);
    await page.getByRole("button", { name: "刪除", exact: true }).click();
    await expect.poll(async () => (await parentDocument(page)).popups.length).toBe(0);
    await page.getByRole("button", { name: "復原", exact: true }).click();
    await expect.poll(async () => (await parentDocument(page)).popups.length).toBe(1);
    await page.getByRole("button", { name: "復原", exact: true }).click();
    await expect.poll(async () => (await parentDocument(page)).popups.length).toBe(0);
    await page.getByRole("button", { name: "重做", exact: true }).click();
    await expect.poll(async () => (await parentDocument(page)).popups.length).toBe(1);
  });

  test("selecting a canvas node opens its settings and Delete removes it outside inputs only", async ({ page }) => {
    await page.goto("/browser-qa/funnel-editor");
    await palette(page, "區段").click();
    await palette(page, "欄列").click();
    await palette(page, "文字").click();
    const text = page.locator('[data-funnel-node-type="text"]');
    await text.click();
    const panel = page.getByRole("complementary", { name: "編輯面板" });
    await expect(panel.getByRole("heading", { name: "文字", exact: true })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "目前選取位置" })).toContainText("區段欄列文字");
    await panel.getByRole("textbox", { name: "文字內容" }).press("Delete");
    await expect.poll(async () => JSON.stringify((await parentDocument(page)).root)).toContain('"type":"text"');
    // Clicking the canvas node moves focus out of the text field again.
    await text.click();
    await page.keyboard.press("Delete");
    await expect.poll(async () => JSON.stringify((await parentDocument(page)).root)).not.toContain('"type":"text"');
    await expect(panel.getByRole("tab", { name: "元件", exact: true })).toBeVisible();
  });
});

async function openFlow(page: Page) {
  await page.goto("/browser-qa/funnel-editor");
  // The dynamic editor appears only after the parent has hydrated.
  await expect(palette(page, "區段")).toBeVisible();
  await page.getByRole("button", { name: "測試多步驟流程", exact: true }).click();
  await expect(page.getByRole("region", { name: "編輯畫布" })).toBeVisible();
}
async function flowDocument(page: Page) {
  return JSON.parse(await page.getByTestId("flow-document").innerText());
}
async function activeRootLength(page: Page) {
  const doc = await flowDocument(page);
  return doc.pages[doc.activeStepId].root.length as number;
}
test.describe("Delivered workspace multi-step flow", () => {
  test("only the active step's canvas is edited; step management stays on the management page", async ({ page }) => {
    await openFlow(page);
    await expect(page.getByRole("button", { name: "＋ 新增步驟", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "流程 復原", exact: true })).toHaveCount(0);
    await expect(page.getByLabel("網站步驟", { exact: true })).toHaveCount(0);
    const initial = await flowDocument(page);
    await palette(page, "區段").click();
    await expect.poll(() => activeRootLength(page)).toBe(initial.pages[initial.activeStepId].root.length + 1);
    const next = await flowDocument(page);
    expect(next.flow).toEqual(initial.flow);
    for (const stepId of Object.keys(initial.pages).filter((id) => id !== initial.activeStepId)) expect(next.pages[stepId]).toEqual(initial.pages[stepId]);
  });
  test("outer rejection never ghosts canvas content or history", async ({ page }) => {
    await openFlow(page);
    const initial = await flowDocument(page);
    await page.getByRole("button", { name: "切換拒絕修改" }).click();
    await palette(page, "區段").click();
    expect(await flowDocument(page)).toEqual(initial);
    await expect(page.getByRole("button", { name: "復原", exact: true })).toBeDisabled();
    await expect(page.getByRole("main").getByRole("alert")).toHaveText("父層未接受這次修改，請重新確認草稿。");
    await page.getByRole("button", { name: "切換拒絕修改" }).click();
    await palette(page, "區段").click();
    await expect.poll(() => activeRootLength(page)).toBe(initial.pages[initial.activeStepId].root.length + 1);
    const accepted = await flowDocument(page);
    // The framework's route announcer also has role=alert outside this editor.
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
    await page.getByRole("button", { name: "切換拒絕修改" }).click();
    await page.getByRole("button", { name: "復原", exact: true }).click();
    expect(await flowDocument(page)).toEqual(accepted);
    await page.getByRole("button", { name: "切換拒絕修改" }).click();
    await page.getByRole("button", { name: "復原", exact: true }).click();
    await expect.poll(() => activeRootLength(page)).toBe(initial.pages[initial.activeStepId].root.length);
  });
  test("next-step choices are scoped to the parent flow and accepted edits echo", async ({ page }) => {
    await openFlow(page);
    await palette(page, "區段").click();
    await palette(page, "欄列").click();
    await palette(page, "按鈕").click();
    await page.getByRole("navigation", { name: "目前選取位置" }).getByRole("button", { name: "選取按鈕", exact: true }).click();
    await page.getByRole("button", { name: "動作", exact: true }).click();
    await page.getByLabel("點擊後動作").selectOption("next_step");
    const doc = await flowDocument(page);
    const ids = doc.flow.steps.map((step: { id: string }) => step.id);
    const choices = await page.getByRole("combobox", { name: "下一個步驟", exact: true }).locator("option").evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
    expect(choices).toEqual(["", ...ids]);
    await page.getByRole("combobox", { name: "下一個步驟", exact: true }).selectOption(ids[1]);
    await page.getByRole("button", { name: "套用動作", exact: true }).click();
    await expect.poll(async () => {
      const next = await flowDocument(page);
      return JSON.stringify(next.pages[next.activeStepId].root);
    }).toContain(`"stepId":"${ids[1]}"`);
    await page.getByRole("button", { name: "回傳相同流程" }).click();
    await expect(page.getByRole("combobox", { name: "下一個步驟", exact: true })).toHaveValue(ids[1]);
  });
  test("add, echo, undo, redo and external replacement have one controlled update", async ({ page }) => {
    await openFlow(page);
    const initial = await activeRootLength(page);
    await palette(page, "區段").click();
    await expect.poll(() => activeRootLength(page)).toBe(initial + 1);
    await expect(page.getByTestId("change-count")).toHaveText("1");
    await page.getByRole("button", { name: "回傳相同流程" }).click();
    await page.getByRole("button", { name: "復原", exact: true }).click();
    await expect.poll(() => activeRootLength(page)).toBe(initial);
    await page.getByRole("button", { name: "重做", exact: true }).click();
    await expect.poll(() => activeRootLength(page)).toBe(initial + 1);
    await page.getByRole("button", { name: "載入外部流程" }).click();
    await expect(page.getByRole("button", { name: "復原", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "重做", exact: true })).toBeDisabled();
    await expect.poll(() => activeRootLength(page)).toBe(initial);
  });
  test("read-only mode blocks canvas edits and history", async ({ page }) => {
    await openFlow(page);
    await palette(page, "區段").click();
    const before = await page.getByTestId("flow-document").innerText();
    await page.getByRole("button", { name: "切換唯讀" }).click();
    await expect(palette(page, "區段")).toBeDisabled();
    await expect(page.getByRole("button", { name: "復原", exact: true })).toBeDisabled();
    await page.keyboard.press("Control+z");
    await expect(page.getByTestId("flow-document")).toHaveText(before);
  });
});
