import { createHash, randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/lib/password";

const db = new PrismaClient();
const runId = randomUUID();
const slug = `wp128-unpublished-${runId}`;
const headlineCanary = `WP128 fixture headline ${runId}`;
const emailCanary = `wp128-fixture-${runId}@example.invalid`;
const loopbackHost = /^(127\.0\.0\.1|localhost)$/;
const fixture = { vendorId: "", userId: "", teamId: "", templateId: "", pageId: "" };

test.beforeAll(async () => {
  const passwordHash = hashPassword("Wp128SyntheticPassword!");
  const vendor = await db.vendor.create({
    data: {
      name: `WP128 Unpublished Vendor ${runId}`,
      slug: `wp128-vendor-${runId}`,
      email: `wp128-vendor-${runId}@celebratedeal.test`,
      passwordHash,
    },
  });
  const user = await db.user.create({
    data: {
      name: `WP128 Unpublished Partner ${runId}`,
      email: `wp128-partner-${runId}@celebratedeal.test`,
      passwordHash,
      memberships: { create: { vendorId: vendor.id, role: "owner", status: "active" } },
    },
  });
  const vendorMember = await db.vendorMember.findUniqueOrThrow({ where: { vendorId_userId: { vendorId: vendor.id, userId: user.id } } });
  const team = await db.salesTeam.create({ data: { vendorId: vendor.id, name: `WP128 Team ${runId}`, slug: `wp128-team-${runId}` } });
  const membership = await db.teamMembership.create({ data: { vendorId: vendor.id, teamId: team.id, vendorMemberId: vendorMember.id } });
  const template = await db.teamFunnelTemplate.create({ data: { vendorId: vendor.id, teamId: team.id, name: `WP128 Template ${runId}` } });
  const version = await db.teamFunnelTemplateVersion.create({
    data: {
      vendorId: vendor.id,
      teamId: team.id,
      templateId: template.id,
      version: 1,
      contentOwnerMembershipId: membership.id,
      createdByMemberId: vendorMember.id,
      headline: headlineCanary,
      ctaLabel: "WP128 CTA",
    },
  });
  const page = await db.partnerFunnelPage.create({
    data: {
      vendorId: vendor.id,
      teamId: team.id,
      templateVersionId: version.id,
      promoterMembershipId: membership.id,
      contentOwnerMembershipId: membership.id,
      slug,
      headline: headlineCanary,
      ctaLabel: "WP128 CTA",
    },
  });
  await db.partnerFunnelPageShareSetting.create({
    data: {
      pageId: page.id,
      accessMode: "TOKEN_REQUIRED",
      isEnabled: true,
      tokenHash: createHash("sha256")
        .update(`wp128-test-only-share-hash:${runId}`, "utf8")
        .digest("hex"),
    },
  });
  fixture.vendorId = vendor.id;
  fixture.userId = user.id;
  fixture.teamId = team.id;
  fixture.templateId = template.id;
  fixture.pageId = page.id;
});

test.afterAll(async () => {
  if (fixture.vendorId) {
    await db.partnerFunnelPage.deleteMany({ where: { id: fixture.pageId } });
    await db.teamFunnelTemplate.deleteMany({ where: { id: fixture.templateId } });
    await db.salesTeam.deleteMany({ where: { id: fixture.teamId } });
    await db.vendor.deleteMany({ where: { id: fixture.vendorId } });
  }
  if (fixture.userId) await db.user.deleteMany({ where: { id: fixture.userId } });
  await db.$disconnect();
});

async function assertUnavailableState(page: Page) {
  const response = await page.goto(`/p/${slug}`, { waitUntil: "load" });
  expect(response?.status()).toBe(200);
  const actualUrl = new URL(page.url());
  expect(actualUrl.pathname).toBe(`/p/${slug}`);
  await expect(page.locator("main").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "此頁尚未公開" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("目前無法提供瀏覽");
  await expect(page.getByText(headlineCanary, { exact: true })).toHaveCount(0);
  await expect(page.getByText(emailCanary, { exact: true })).toHaveCount(0);
  const documentContent = await page.content();
  expect(documentContent).not.toContain(headlineCanary);
  expect(documentContent).not.toContain(emailCanary);

  const recovery = page.getByRole("link", { name: "返回首頁" });
  await expect(recovery).toHaveAttribute("href", "/");
  await recovery.focus();
  await expect(recovery).toBeFocused();
  const box = await recovery.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(axe.violations.filter((violation) => violation.impact === "critical" || violation.impact === "serious")).toEqual([]);
}

test("unpublished partner state is recoverable and accessible on desktop", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (["http:", "https:"].includes(url.protocol) && !loopbackHost.test(url.hostname)) requests.push("external");
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await assertUnavailableState(page);
  expect(requests).toEqual([]);
});

test("unpublished partner state has no mobile overflow", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (["http:", "https:"].includes(url.protocol) && !loopbackHost.test(url.hostname)) requests.push("external");
  });
  await page.setViewportSize({ width: 320, height: 844 });
  await assertUnavailableState(page);
  expect(requests).toEqual([]);
});
