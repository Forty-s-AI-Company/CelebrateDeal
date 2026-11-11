import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { emptyLiveStudioDraft } from "../../src/lib/live-studio-draft";
import {
  createLiveStudioFixture,
  deleteLiveStudioFixture,
  fillReportedLiveStudioState,
  liveStudioStepButton,
  loginLiveStudioOwner,
  type LiveStudioFixture,
} from "../fixtures/live-studio";

// Synthetic loopback-only tenant; no payment, email or external stream call is made.
const db = new PrismaClient({ log: [] });
test.use({ trace: "off", screenshot: "off", video: "off" });
test.setTimeout(180_000);
test.afterAll(async () => db.$disconnect());

test("resumed live studio draft keeps every binding, reuses its row and schedules without a native dialog", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const nativeDialogs: string[] = [];
  // A native confirm() blocks the renderer and every CDP command until it is
  // answered; browser agents saw that as a frozen page. Fail if one appears.
  page.on("dialog", (dialog) => {
    nativeDialogs.push(dialog.message());
    void dialog.dismiss();
  });
  let fixture: LiveStudioFixture | undefined;
  try {
    fixture = await createLiveStudioFixture(db);
    const slug = `whole-food-live-${fixture.id.slice(0, 8)}`;
    await loginLiveStudioOwner(page, fixture);
    await page.goto("/lives/new");
    await fillReportedLiveStudioState(page, fixture, slug);

    await page.getByRole("button", { name: "立即儲存草稿", exact: true }).click();
    await expect(page.getByText("草稿已儲存，可安全離開後再繼續。")).toBeVisible();
    await expect.poll(() => db.liveStudioDraft.count({ where: { vendorId: fixture!.vendor.id } })).toBe(1);
    const savedDraft = await db.liveStudioDraft.findFirstOrThrow({ where: { vendorId: fixture.vendor.id } });

    // Start from a fresh blank studio, then resume through the in-app link
    // (a client navigation to the same route, which previously kept stale state).
    await page.goto("/lives/new");
    await page.getByRole("link", { name: "繼續這份草稿" }).click();
    await expect(page).toHaveURL(new RegExp(`/lives/new\\?draft=${savedDraft.id}$`, "u"));

    await expect(liveStudioStepButton(page, "publish")).toHaveAttribute("aria-current", "step");
    await expect(page.getByLabel("直播標題")).toHaveValue("我吃原型食物就好!?");
    await expect(page.getByLabel("直播網址")).toHaveValue(slug);
    await expect(page.getByLabel("直播說明")).toHaveValue("合成說明：原型食物入門。");
    await expect(page.locator("select[name=videoId]")).toHaveValue(fixture.video.id);
    // Earlier step panels are `hidden` (and 進階設定 collapsed), so query by name rather than accessible role.
    await expect(page.locator(`input[name=productIds][value="${fixture.product.id}"]`)).toBeChecked();
    await expect(page.getByLabel("促銷短句")).toHaveValue("直播限定原型食物優惠");
    await expect(page.locator("select[name=formId]")).toHaveValue(fixture.form.id);
    await expect(page.getByLabel(/^開播時間/u)).toHaveValue("2026-11-29T20:00");
    await expect(page.getByLabel("直播結束後允許回放")).toBeChecked();
    await expect(page.getByLabel(/^回放觀看期限/u)).toHaveValue("2026-12-15T23:59");
    await expect(page.locator("select[name=messageTemplateId]")).toHaveValue(fixture.template.id);
    await expect(page.locator("select[name=interactionScriptId]")).toHaveValue(fixture.script.id);
    await expect(page.getByText("發布條件已完成")).toBeVisible();

    // Saving again after a resume updates the same version-protected row.
    await page.getByRole("button", { name: "立即儲存草稿", exact: true }).click();
    await expect.poll(async () => (await db.liveStudioDraft.findUniqueOrThrow({ where: { id: savedDraft.id } })).revision)
      .toBeGreaterThan(savedDraft.revision);
    expect(await db.liveStudioDraft.count({ where: { vendorId: fixture.vendor.id } })).toBe(1);
    await expect(page.getByText("草稿已儲存，可安全離開後再繼續。")).toBeVisible();

    let draftPostsDuringSubmit = 0;
    page.on("request", (request) => {
      if (request.method() === "POST" && new URL(request.url()).pathname === "/api/live-studio/drafts") draftPostsDuringSubmit += 1;
    });
    await page.getByRole("button", { name: "建立並排程", exact: true }).click();
    const confirmation = page.getByRole("alertdialog", { name: "確定要建立並排程這場直播嗎？" });
    await expect(confirmation).toBeVisible();
    // The page stays scriptable while the in-page confirmation is open.
    expect(await page.evaluate(() => document.readyState)).toBe("complete");
    await confirmation.getByRole("button", { name: "確認建立並排程", exact: true }).click();

    await expect(page).toHaveURL(/\/lives\/[^/]+\/preview$/u, { timeout: 60_000 });
    const liveId = new URL(page.url()).pathname.split("/")[2]!;
    const live = await db.live.findUniqueOrThrow({
      where: { id: liveId },
      select: {
        vendorId: true, title: true, slug: true, status: true, streamMode: true, videoId: true, formId: true,
        messageTemplateId: true, interactionScriptId: true, replayEnabled: true, replayAvailableUntil: true, scheduledAt: true,
        products: { select: { productId: true } },
      },
    });
    expect(live).toEqual({
      vendorId: fixture.vendor.id,
      title: "我吃原型食物就好!?",
      slug,
      status: "scheduled",
      streamMode: "vod",
      videoId: fixture.video.id,
      formId: fixture.form.id,
      messageTemplateId: fixture.template.id,
      interactionScriptId: fixture.script.id,
      replayEnabled: true,
      replayAvailableUntil: new Date("2026-12-15T15:59:00.000Z"),
      scheduledAt: new Date("2026-11-29T12:00:00.000Z"),
      products: [{ productId: fixture.product.id }],
    });
    expect(await db.live.count({ where: { vendorId: fixture.vendor.id } })).toBe(1);
    expect(draftPostsDuringSubmit).toBeLessThanOrEqual(1);
    const drafts = await db.liveStudioDraft.findMany({ where: { vendorId: fixture.vendor.id }, select: { id: true, consumedAt: true } });
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.id).toBe(savedDraft.id);
    expect(drafts[0]?.consumedAt).not.toBeNull();
    expect(nativeDialogs).toEqual([]);
  } finally {
    await deleteLiveStudioFixture(db, fixture);
  }
});

test("an eight-step (v2) draft already in the database resumes on 通知 and schedules after one re-save", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const nativeDialogs: string[] = [];
  page.on("dialog", (dialog) => {
    nativeDialogs.push(dialog.message());
    void dialog.dismiss();
  });
  let fixture: LiveStudioFixture | undefined;
  try {
    fixture = await createLiveStudioFixture(db);
    const slug = `whole-food-v2-${fixture.id.slice(0, 8)}`;
    // Exactly what the eight-step studio stored: flowVersion 2, saved on its Email step (index 5).
    const versionTwoPayload = {
      ...emptyLiveStudioDraft(),
      flowVersion: 2,
      activeStep: 5,
      studioPreset: "COMMERCE",
      title: "八步草稿續編",
      slug,
      scheduledAt: "2026-11-29T20:00",
      videoId: fixture.video.id,
      formId: fixture.form.id,
      messageTemplateId: fixture.template.id,
      interactionScriptId: fixture.script.id,
      productIds: [fixture.product.id],
      accentCopy: "直播限定原型食物優惠",
      replayAvailableUntil: "2026-12-15T23:59",
    };
    const stored = await db.liveStudioDraft.create({ data: {
      vendorId: fixture.vendor.id,
      updatedByMemberId: "synthetic-v2-member",
      payload: versionTwoPayload,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    } });
    await loginLiveStudioOwner(page, fixture);

    await page.goto("/lives/new");
    await expect(page.getByText("第 3 步：通知")).toBeVisible();
    await page.getByRole("link", { name: "繼續這份草稿" }).click();
    await expect(page).toHaveURL(new RegExp(`/lives/new\\?draft=${stored.id}$`, "u"));
    await expect(liveStudioStepButton(page, "notifications")).toHaveAttribute("aria-current", "step");
    await expect(page.locator("select[name=messageTemplateId]")).toHaveValue(fixture.template.id);
    await expect(page.locator("select[name=videoId]")).toHaveValue(fixture.video.id);
    await expect(page.locator(`input[name=productIds][value="${fixture.product.id}"]`)).toBeChecked();

    await liveStudioStepButton(page, "publish").click();
    await expect(page.getByText("發布條件已完成")).toBeVisible();
    await page.getByRole("button", { name: "建立並排程", exact: true }).click();
    await page.getByRole("alertdialog", { name: "確定要建立並排程這場直播嗎？" })
      .getByRole("button", { name: "確認建立並排程", exact: true }).click();

    await expect(page).toHaveURL(/\/lives\/[^/]+\/preview$/u, { timeout: 60_000 });
    const liveId = new URL(page.url()).pathname.split("/")[2]!;
    const live = await db.live.findUniqueOrThrow({
      where: { id: liveId },
      select: { vendorId: true, title: true, slug: true, status: true, videoId: true, formId: true, messageTemplateId: true, products: { select: { productId: true } } },
    });
    expect(live).toEqual({
      vendorId: fixture.vendor.id,
      title: "八步草稿續編",
      slug,
      status: "scheduled",
      videoId: fixture.video.id,
      formId: fixture.form.id,
      messageTemplateId: fixture.template.id,
      products: [{ productId: fixture.product.id }],
    });
    const consumed = await db.liveStudioDraft.findUniqueOrThrow({ where: { id: stored.id } });
    expect(consumed.consumedAt).not.toBeNull();
    // The row was re-saved as v3 (from the 發布 step) before the publish claim compared it.
    expect(consumed.payload).toMatchObject({ flowVersion: 3, activeStep: 3, title: "八步草稿續編" });
    expect(consumed.revision).toBeGreaterThan(stored.revision);
    expect(await db.liveStudioDraft.count({ where: { vendorId: fixture.vendor.id } })).toBe(1);
    expect(nativeDialogs).toEqual([]);
  } finally {
    await deleteLiveStudioFixture(db, fixture);
  }
});
