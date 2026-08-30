import { randomUUID } from "node:crypto";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { createTeamFunnelFixture, TEAM_FUNNEL_TEST_ONLY } from "../fixtures/team-funnel";

const db = new PrismaClient();

/**
 * This is deliberately a release-mode Browser test. It proves that a value
 * inserted into the real form DOM cannot bypass the Server Action's owner
 * predicate, and it asserts that the rejected request is write-free.
 */
test("member A cannot publish a template bound to member B's webinar through DOM tampering", async ({ browser }, testInfo) => {
  test.setTimeout(180_000);

  const runKey = `wp25-${Date.now().toString(36)}-${testInfo.workerIndex}-${randomUUID().slice(0, 8)}`;
  const fixture = await createTeamFunnelFixture(db, runKey);
  let context: BrowserContext | undefined;

  const login = async (page: Page) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(fixture.leader.email);
    await page.getByLabel("密碼").fill(fixture.password);
    await page.getByRole("button", { name: "登入" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
  };

  try {
    const partnerWebinar = await db.live.create({
      data: {
        vendorId: fixture.leader.vendorId,
        teamId: fixture.team.id,
        seminarOwnerMembershipId: fixture.partner.membershipId,
        formId: fixture.form.id,
        title: "TEST ONLY B 的禁止綁定研討會",
        slug: `test-only-wp25-b-${runKey}`.toLowerCase(),
        scheduledAt: new Date("2030-08-02T02:00:00.000Z"),
        status: "scheduled",
      },
    });

    context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      extraHTTPHeaders: { "X-Forwarded-For": "2001:db8:25::1" },
    });
    const page = await context.newPage();
    await login(page);

    // Create A's own source page through the production form before trying
    // the negative publish path. This supplies a real template and source
    // page that the Server Action is otherwise authorized to update.
    await page.goto("/team-templates/new");
    await expect(page.getByRole("heading", { name: "建立團隊原始頁" })).toBeVisible();
    await page.getByLabel("模板名稱").fill(`${TEAM_FUNNEL_TEST_ONLY.templateName} WP25`);
    await page.getByLabel("原始頁網址（slug）").fill(`wp25-a-source-${runKey}`.toLowerCase());
    await page.getByLabel("綁定 webinar").selectOption(fixture.seminar.id);
    await page.getByRole("textbox", { name: "主標題" }).fill("TEST ONLY WP25 A 主標題");
    await page.getByRole("textbox", { name: "CTA 按鈕文字" }).fill("TEST ONLY WP25 CTA");
    await page.getByRole("button", { name: "建立原始頁" }).click();
    await expect(page.getByRole("status").filter({ hasText: "原始頁與第一個模板版本已建立" })).toBeVisible();

    const template = await db.teamFunnelTemplate.findFirstOrThrow({
      where: { vendorId: fixture.leader.vendorId, name: `${TEAM_FUNNEL_TEST_ONLY.templateName} WP25` },
      select: { id: true },
    });
    const sourcePage = await db.partnerFunnelPage.findFirstOrThrow({
      where: {
        teamId: fixture.team.id,
        promoterMembershipId: fixture.leader.membershipId,
        templateVersion: { templateId: template.id },
      },
      select: { id: true, liveId: true },
    });
    expect(sourcePage.liveId).toBe(fixture.seminar.id);

    const versionsBefore = await db.teamFunnelTemplateVersion.findMany({
      where: { vendorId: fixture.leader.vendorId },
      orderBy: [{ templateId: "asc" }, { version: "asc" }],
      select: { id: true, templateId: true, version: true, contentOwnerMembershipId: true, createdByMemberId: true, headline: true, subheadline: true, body: true, ctaLabel: true, ctaUrl: true },
    });
    const pagesBefore = await db.partnerFunnelPage.findMany({
      where: { vendorId: fixture.leader.vendorId },
      orderBy: { id: "asc" },
      select: { id: true, templateVersionId: true, promoterMembershipId: true, contentOwnerMembershipId: true, liveId: true, slug: true, headline: true, subheadline: true, body: true, ctaLabel: true, ctaUrl: true },
    });
    const versionCountBefore = await db.teamFunnelTemplateVersion.count({ where: { templateId: template.id } });

    await page.goto(`/team-templates/${template.id}/edit`);
    await expect(page.getByRole("heading", { name: new RegExp(`編輯 ${TEAM_FUNNEL_TEST_ONLY.templateName} WP25`) })).toBeVisible();
    const webinarSelect = page.locator('select[name="webinarId"]');
    await expect(webinarSelect.locator(`option[value="${partnerWebinar.id}"]`)).toHaveCount(0);

    // The option is absent in the rendered UI. Insert it in the live DOM to
    // exercise a malicious form submission while retaining the real browser
    // form and Server Action mutation path.
    await webinarSelect.evaluate((select, webinar) => {
      const dropdown = select as HTMLSelectElement;
      const option = new Option(webinar.title, webinar.id, true, true);
      dropdown.add(option);
      dropdown.value = webinar.id;
      dropdown.dispatchEvent(new Event("input", { bubbles: true }));
      dropdown.dispatchEvent(new Event("change", { bubbles: true }));
    }, { id: partnerWebinar.id, title: partnerWebinar.title });

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "發布新版本" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "你沒有管理這個團隊模板的權限，或該資源已不存在。" })).toHaveText("你沒有管理這個團隊模板的權限，或該資源已不存在。");

    expect(await db.teamFunnelTemplateVersion.count({ where: { templateId: template.id } })).toBe(versionCountBefore);
    await expect.poll(async () => db.partnerFunnelPage.findUniqueOrThrow({
      where: { id: sourcePage.id },
      select: { liveId: true },
    })).toEqual({ liveId: fixture.seminar.id });
    await expect.poll(async () => db.teamFunnelTemplateVersion.findMany({
      where: { vendorId: fixture.leader.vendorId },
      orderBy: [{ templateId: "asc" }, { version: "asc" }],
      select: { id: true, templateId: true, version: true, contentOwnerMembershipId: true, createdByMemberId: true, headline: true, subheadline: true, body: true, ctaLabel: true, ctaUrl: true },
    })).toEqual(versionsBefore);
    await expect.poll(async () => db.partnerFunnelPage.findMany({
      where: { vendorId: fixture.leader.vendorId },
      orderBy: { id: "asc" },
      select: { id: true, templateVersionId: true, promoterMembershipId: true, contentOwnerMembershipId: true, liveId: true, slug: true, headline: true, subheadline: true, body: true, ctaLabel: true, ctaUrl: true },
    })).toEqual(pagesBefore);
  } finally {
    await context?.close();
    await fixture.cleanup();
  }
});

test.afterAll(async () => {
  await db.$disconnect();
});
