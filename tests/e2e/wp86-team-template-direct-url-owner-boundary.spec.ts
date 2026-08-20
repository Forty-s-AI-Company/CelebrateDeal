import { randomUUID } from "node:crypto";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { createTeamFunnelFixture, TEAM_FUNNEL_TEST_ONLY } from "../fixtures/team-funnel";
import { navigateAndAssertDirectUrlGuard } from "./helpers/direct-url-guard";

const db = new PrismaClient();

/**
 * WP-86 only proves the direct-URL counterpart of the existing webinar owner
 * boundary test. The existing spec remains the immutable mutation test: a
 * member cannot bind another member's webinar by tampering with the DOM.
 */
test("same-team non-owner cannot read another member's template edit URL", async ({ browser }, testInfo) => {
  test.setTimeout(180_000);

  const runKey = `wp86-${Date.now().toString(36)}-${testInfo.workerIndex}-${randomUUID().slice(0, 8)}`;
  const fixture = await createTeamFunnelFixture(db, runKey);
  let ownerContext: BrowserContext | undefined;
  let nonOwnerContext: BrowserContext | undefined;

  const login = async (page: Page, email: string) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("密碼").fill(fixture.password);
    await page.getByRole("button", { name: "登入" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
  };

  try {
    // B owns this webinar while A remains a member of the very same team.
    const ownerWebinar = await db.live.create({
      data: {
        vendorId: fixture.leader.vendorId,
        teamId: fixture.team.id,
        seminarOwnerMembershipId: fixture.partner.membershipId,
        formId: fixture.form.id,
        title: "TEST ONLY WP86 B 的私有研討會",
        slug: `test-only-wp86-b-${runKey}`.toLowerCase(),
        scheduledAt: new Date("2030-08-03T02:00:00.000Z"),
        status: "scheduled",
      },
    });

    ownerContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const ownerPage = await ownerContext.newPage();
    await login(ownerPage, fixture.partner.email);
    await ownerPage.goto("/team-templates/new");
    await ownerPage.getByLabel("模板名稱").fill(`${TEAM_FUNNEL_TEST_ONLY.templateName} WP86 B`);
    await ownerPage.getByLabel("原始頁網址（slug）").fill(`wp86-b-source-${runKey}`.toLowerCase());
    await ownerPage.getByLabel("綁定 webinar").selectOption(ownerWebinar.id);
    await ownerPage.getByRole("textbox", { name: "主標題" }).fill("TEST ONLY WP86 B 私有主標題");
    await ownerPage.getByRole("textbox", { name: "CTA 按鈕文字" }).fill("TEST ONLY WP86 B CTA");
    await ownerPage.getByRole("button", { name: "建立原始頁" }).click();
    await expect(ownerPage.getByRole("status").filter({ hasText: "原始頁與第一個模板版本已建立" })).toBeVisible();

    const template = await db.teamFunnelTemplate.findFirstOrThrow({
      where: { vendorId: fixture.leader.vendorId, name: `${TEAM_FUNNEL_TEST_ONLY.templateName} WP86 B` },
      select: { id: true },
    });
    const ownerUrl = `/team-templates/${template.id}/edit`;
    await ownerPage.goto(ownerUrl);
    await expect(ownerPage.getByRole("heading", { name: new RegExp(`編輯 ${TEAM_FUNNEL_TEST_ONLY.templateName} WP86 B`) })).toBeVisible();

    const privateBefore = await db.teamFunnelTemplate.findUniqueOrThrow({
      where: { id: template.id },
      select: {
        id: true,
        name: true,
        versions: { orderBy: { version: "asc" }, select: { id: true, version: true, headline: true, createdByMemberId: true, contentOwnerMembershipId: true } },
      },
    });
    const sourceBefore = await db.partnerFunnelPage.findFirstOrThrow({
      where: { vendorId: fixture.leader.vendorId, templateVersion: { templateId: template.id } },
      select: { id: true, liveId: true, headline: true, ctaLabel: true, contentOwnerMembershipId: true },
    });

    nonOwnerContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const nonOwnerPage = await nonOwnerContext.newPage();
    await login(nonOwnerPage, fixture.leader.email);
    const templateCanaries = [
      `${TEAM_FUNNEL_TEST_ONLY.templateName} WP86 B`,
      "TEST ONLY WP86 B 私有主標題",
    ];
    const { finalResponse } = await navigateAndAssertDirectUrlGuard({
      page: nonOwnerPage,
      path: ownerUrl,
      routeIdentityCanaries: [template.id, ownerUrl],
      protectedPayloadCanaries: templateCanaries,
      documentCanaries: templateCanaries,
      finalUrl: ownerUrl,
      transport: { kind: "streaming-not-found", status: 200 },
      finalStatus: 200,
    });
    expect(finalResponse?.status()).toBe(200);
    await expect(nonOwnerPage.getByText(`${TEAM_FUNNEL_TEST_ONLY.templateName} WP86 B`)).toHaveCount(0);
    await expect(nonOwnerPage.getByText("TEST ONLY WP86 B 私有主標題")).toHaveCount(0);
    await expect(nonOwnerPage.locator('select[name="webinarId"]')).toHaveCount(0);
    await expect(nonOwnerPage.getByRole("button", { name: "發布新版本" })).toHaveCount(0);

    await expect.poll(async () => db.teamFunnelTemplate.findUniqueOrThrow({
      where: { id: template.id },
      select: {
        id: true,
        name: true,
        versions: { orderBy: { version: "asc" }, select: { id: true, version: true, headline: true, createdByMemberId: true, contentOwnerMembershipId: true } },
      },
    })).toEqual(privateBefore);
    await expect.poll(async () => db.partnerFunnelPage.findFirstOrThrow({
      where: { vendorId: fixture.leader.vendorId, templateVersion: { templateId: template.id } },
      select: { id: true, liveId: true, headline: true, ctaLabel: true, contentOwnerMembershipId: true },
    })).toEqual(sourceBefore);
  } finally {
    await nonOwnerContext?.close();
    await ownerContext?.close();
    await fixture.cleanup();
  }
});

test.afterAll(async () => {
  await db.$disconnect();
});
