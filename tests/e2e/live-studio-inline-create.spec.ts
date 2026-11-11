import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { formatZonedDateTimeLocal } from "../../src/lib/zoned-date-time";
import {
  createLiveStudioFixtureWithoutRegistrationResources,
  deleteLiveStudioFixture,
  liveStudioStepButton,
  loginLiveStudioOwner,
  openLiveStudioAdvancedSettings,
  type LiveStudioFixture,
} from "../fixtures/live-studio";

// Synthetic loopback-only tenant without any registration form or template;
// no payment, email or external stream call is made.
const db = new PrismaClient({ log: [] });
test.use({ trace: "off", screenshot: "off", video: "off" });
test.setTimeout(180_000);
test.afterAll(async () => db.$disconnect());

test("a merchant without a form or template creates both in the studio's drawers and reaches 發布 without leaving /lives/new", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const nativeDialogs: string[] = [];
  page.on("dialog", (dialog) => {
    nativeDialogs.push(dialog.message());
    void dialog.dismiss();
  });
  const documentNavigations: string[] = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) documentNavigations.push(new URL(frame.url()).pathname);
  });
  let fixture: LiveStudioFixture | undefined;
  try {
    fixture = await createLiveStudioFixtureWithoutRegistrationResources(db);
    const slug = `inline-create-${fixture.id.slice(0, 8)}`;
    await loginLiveStudioOwner(page, fixture);
    await page.goto("/lives/new");
    documentNavigations.length = 0;

    // 內容
    await page.getByRole("button", { name: /內容／課程直播/u }).click();
    const title = page.getByLabel("直播標題");
    await title.fill("就地建立的週五講座");
    const titleNode = await title.elementHandle();
    await page.locator("select[name=videoId]").selectOption(fixture.video.id);
    await expect(page.getByText("目前沒有可用報名頁，可以在這裡直接建立。")).toBeVisible();

    const openForm = page.getByRole("button", { name: "新增報名表", exact: true });
    await openForm.click();
    const formDrawer = page.getByRole("dialog", { name: "新增報名表" });
    await expect(formDrawer).toBeVisible();
    await expect(formDrawer.getByLabel("表單名稱")).toBeFocused();
    await expect(formDrawer.getByLabel("表單名稱")).toHaveValue("就地建立的週五講座 報名表");
    // A missing name keeps the drawer open with the field message.
    await formDrawer.getByLabel("表單名稱").fill("");
    await formDrawer.getByRole("button", { name: "建立並選取" }).click();
    await expect(formDrawer.getByText("請填寫表單名稱。")).toBeVisible();
    await expect(formDrawer.getByLabel("表單名稱")).toHaveAttribute("aria-invalid", "true");
    await formDrawer.getByLabel("表單名稱").fill("週五講座報名表");
    await formDrawer.getByRole("button", { name: "建立並選取" }).click();

    await expect(formDrawer).toBeHidden();
    await expect(page.getByText("已建立並選取報名表「週五講座報名表」。")).toBeVisible();
    const formSelect = page.locator("select[name=formId]");
    await expect(formSelect).toBeFocused();
    const createdForm = await db.registrationForm.findFirstOrThrow({ where: { vendorId: fixture.vendor.id } });
    expect(createdForm).toMatchObject({ name: "週五講座報名表", headline: "就地建立的週五講座", isActive: true });
    await expect(formSelect).toHaveValue(createdForm.id);
    // The form create revalidates the page; the studio keeps its DOM and edits.
    expect(await titleNode!.evaluate((node) => node.isConnected)).toBe(true);
    await expect(title).toHaveValue("就地建立的週五講座");

    // A week from now in the studio's Taipei time, so the schedule never becomes a past time.
    await page.getByLabel(/^開播時間/u).fill(formatZonedDateTimeLocal(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), "Asia/Taipei"));
    await openLiveStudioAdvancedSettings(page, "content");
    await page.getByLabel("直播網址").fill(slug);
    await page.getByRole("button", { name: "下一步", exact: true }).click();
    await page.getByRole("button", { name: "下一步", exact: true }).click();

    // 通知
    await expect(liveStudioStepButton(page, "notifications")).toHaveAttribute("aria-current", "step");
    await page.getByRole("button", { name: "建立報名成功 Email", exact: true }).click();
    const templateDrawer = page.getByRole("dialog", { name: "建立報名成功 Email" });
    await expect(templateDrawer).toBeVisible();
    await templateDrawer.getByLabel("Email 主旨").fill("{{coupon_code}} 報名成功");
    await templateDrawer.getByRole("button", { name: "建立並選取" }).click();
    await expect(templateDrawer.getByText("主旨含有不支援的變數，只能使用下方列出的變數。")).toBeVisible();
    await templateDrawer.getByLabel("Email 主旨").fill("{{live_title}} 報名成功");
    await templateDrawer.getByRole("button", { name: "建立並選取" }).click();
    await expect(templateDrawer).toBeHidden();
    const createdTemplate = await db.messageTemplate.findFirstOrThrow({ where: { vendorId: fixture.vendor.id } });
    expect(createdTemplate).toMatchObject({ channel: "email", trigger: "registration_confirmed", isActive: true });
    const templateSelect = page.locator("select[name=messageTemplateId]");
    await expect(templateSelect).toHaveValue(createdTemplate.id);
    await expect(templateSelect).toBeFocused();

    // A reminder template from the rules group enables that group's 新增 button.
    const addBeforeLive = page.locator('[data-notification-add="before_live"]');
    await expect(addBeforeLive).toBeDisabled();
    await page.getByRole("button", { name: "建立開播提醒 Email" }).first().click();
    const reminderDrawer = page.getByRole("dialog", { name: "建立開播提醒 Email" });
    await reminderDrawer.getByRole("button", { name: "建立並選取" }).click();
    await expect(reminderDrawer).toBeHidden();
    await expect(addBeforeLive).toBeEnabled();
    await expect(addBeforeLive).toBeFocused();

    await page.getByRole("button", { name: "下一步", exact: true }).click();
    await expect(liveStudioStepButton(page, "publish")).toHaveAttribute("aria-current", "step");
    await expect(page.getByText("已完成 · 有效的報名表單")).toBeVisible();
    await expect(page.getByText("已完成 · 可寄送的報名成功 Email")).toBeVisible();
    await expect(page.getByText("發布條件已完成")).toBeVisible();
    await expect(title).toHaveValue("就地建立的週五講座");
    expect(new URL(page.url()).pathname).toBe("/lives/new");
    expect(documentNavigations.filter((pathname) => pathname !== "/lives/new")).toEqual([]);

    // The autosaved draft carries both new ids, and scheduling binds them.
    await expect.poll(async () => {
      const draft = await db.liveStudioDraft.findFirst({ where: { vendorId: fixture!.vendor.id }, select: { payload: true } });
      const payload = draft?.payload as { formId?: string; messageTemplateId?: string } | undefined;
      return payload ? [payload.formId, payload.messageTemplateId] : null;
    }).toEqual([createdForm.id, createdTemplate.id]);
    await page.getByRole("button", { name: "建立並排程", exact: true }).click();
    await page.getByRole("alertdialog", { name: "確定要建立並排程這場直播嗎？" })
      .getByRole("button", { name: "確認建立並排程", exact: true }).click();
    await expect(page).toHaveURL(/\/lives\/[^/]+\/preview$/u, { timeout: 60_000 });
    const live = await db.live.findFirstOrThrow({ where: { vendorId: fixture.vendor.id }, select: { title: true, formId: true, messageTemplateId: true, status: true } });
    expect(live).toEqual({ title: "就地建立的週五講座", formId: createdForm.id, messageTemplateId: createdTemplate.id, status: "scheduled" });
    expect(nativeDialogs).toEqual([]);
  } finally {
    await deleteLiveStudioFixture(db, fixture);
  }
});
