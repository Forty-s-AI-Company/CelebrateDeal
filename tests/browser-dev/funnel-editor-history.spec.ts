import { expect, test, type Page } from "@playwright/test";

async function parentDocument(page: Page) {
  return JSON.parse(await page.getByTestId("parent-document").innerText());
}

test.describe("Funnel editor history lifecycle", () => {
  test("rejected outer parent changes never create ghost canvas or history", async ({ page }) => {
    await page.goto("/browser-qa/funnel-editor");
    await page.getByRole("button", { name: "切換拒絕修改" }).click();
    await page.getByRole("button", { name: "Section", exact: true }).click();
    expect((await parentDocument(page)).root).toHaveLength(0);
    await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
    await expect(page.getByTestId("change-count")).toHaveText("0");
    await page.getByRole("button", { name: "切換拒絕修改" }).click();
    await page.getByRole("button", { name: "Section", exact: true }).click();
    await expect.poll(async () => (await parentDocument(page)).root.length).toBe(1);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect.poll(async () => (await parentDocument(page)).root.length).toBe(0);
  });
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
  // The dynamic editor appears only after the parent has hydrated.
  await expect(page.getByRole("button", { name: "Section", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "測試多步驟流程", exact: true }).click();
  await expect(page.getByLabel("Funnel steps", { exact: true })).toBeVisible();
}
async function flowDocument(page: Page) {
  return JSON.parse(await page.getByTestId("flow-document").innerText());
}
test.describe("Delivered workspace multi-step flow", () => {
  test("outer rejection preserves flow history and accepted canvas before subsequent edits", async ({ page }) => {
    await openFlow(page);
    const initial = await flowDocument(page);
    await page.getByRole("button", { name: "切換拒絕修改" }).click();
    await page.getByRole("button", { name: "Section", exact: true }).click();
    await page.getByRole("button", { name: "＋ 新增步驟", exact: true }).click();
    expect(await flowDocument(page)).toEqual(initial);
    await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "流程 Undo", exact: true })).toBeDisabled();
    await expect(page.getByRole("main").getByRole("alert")).toHaveText("父層未接受這次修改，請重新確認草稿。");
    await page.getByRole("button", { name: "切換拒絕修改" }).click();
    await page.getByRole("button", { name: "＋ 新增步驟", exact: true }).click();
    const accepted = await flowDocument(page);
    expect(accepted.pages[accepted.activeStepId]).toEqual(initial.pages[initial.activeStepId]);
    await page.getByRole("button", { name: "切換拒絕修改" }).click();
    await page.getByRole("button", { name: "流程 Undo", exact: true }).click();
    expect(await flowDocument(page)).toEqual(accepted);
    await expect(page.getByRole("button", { name: "流程 Redo", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "切換拒絕修改" }).click();
    await page.getByRole("button", { name: "流程 Undo", exact: true }).click();
    expect(await flowDocument(page)).toEqual(initial);
  });
  test("deleting a middle added step then adding keeps every URL path unique", async ({ page }) => {
    await openFlow(page);
    page.on("dialog", (dialog) => dialog.accept());
    const initial = await flowDocument(page);
    for (let count = 0; count < 3; count += 1) {
      await page.getByRole("button", { name: "＋ 新增步驟", exact: true }).click();
    }
    await expect.poll(async () => (await flowDocument(page)).flow.steps.length).toBe(initial.flow.steps.length + 3);
    await page.getByRole("button", { name: "移除 新步驟", exact: true }).nth(1).click();
    await page.getByRole("button", { name: "＋ 新增步驟", exact: true }).click();
    await expect.poll(async () => (await flowDocument(page)).flow.steps.length).toBe(initial.flow.steps.length + 3);
    const paths = (await flowDocument(page)).flow.steps.map((step: { path: string }) => step.path);
    expect(new Set(paths).size).toBe(paths.length);
    // The framework's route announcer also has role=alert outside this editor.
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  });
  test("next-step choices are scoped to the parent flow and accepted edits echo", async ({ page }) => {
    await openFlow(page);
    await page.getByRole("button", { name: "Section", exact: true }).click();
    await page.getByRole("button", { name: "Row", exact: true }).click();
    await page.getByRole("button", { name: "按鈕", exact: true }).click();
    await page.getByRole("button", { name: "設定", exact: true }).click();
    await page.getByRole("tab", { name: "動作", exact: true }).click();
    await page.getByLabel("點擊後動作").selectOption("next_step");
    const doc = await flowDocument(page);
    const ids = doc.flow.steps.map((step: { id: string }) => step.id);
    const choices = await page.getByLabel("下一個步驟 ID").locator("option").evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
    expect(choices).toEqual(["", ...ids]);
    await page.getByLabel("下一個步驟 ID").selectOption(ids[1]);
    await page.getByRole("button", { name: "套用動作", exact: true }).click();
    await expect.poll(async () => {
      const next = await flowDocument(page);
      return JSON.stringify(next.pages[next.activeStepId].root);
    }).toContain(`"stepId":"${ids[1]}"`);
    await page.getByRole("button", { name: "回傳相同流程" }).click();
    await expect(page.getByLabel("下一個步驟 ID")).toHaveValue(ids[1]);
  });
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
