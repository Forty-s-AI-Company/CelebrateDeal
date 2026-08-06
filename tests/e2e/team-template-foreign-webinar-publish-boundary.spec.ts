import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/lib/password";

const db = new PrismaClient();
const password = "Wp53SyntheticPassword!";
test.use({ trace: "off", screenshot: "off", video: "off" });

test("template owner cannot publish a payload tampered with another member's webinar", async ({ page }) => {
  const suffix = randomUUID().replace(/-/g, "");
  const canary = `wp53-${suffix}`;
  const vendor = await db.vendor.create({
    data: { name: `WP53 ${suffix}`, slug: `wp53-${suffix}`, email: `wp53-${suffix}@celebratedeal.test`, passwordHash: hashPassword(password), primaryColor: "#2563eb", ctaColor: "#f97316", tracking: { create: {} } },
  });
  const [actor, foreignUser] = await Promise.all([
    db.user.create({ data: { email: `wp53-a-${suffix}@celebratedeal.test`, name: "WP53 Member A", passwordHash: hashPassword(password), status: "active", memberships: { create: { vendorId: vendor.id, role: "owner", status: "active" } } } }),
    db.user.create({ data: { email: `wp53-b-${suffix}@celebratedeal.test`, name: "WP53 Member B", passwordHash: hashPassword(password), status: "active", memberships: { create: { vendorId: vendor.id, role: "owner", status: "active" } } } }),
  ]);
  try {
    const [memberA, memberB] = await Promise.all([
      db.vendorMember.findUniqueOrThrow({ where: { vendorId_userId: { vendorId: vendor.id, userId: actor.id } } }),
      db.vendorMember.findUniqueOrThrow({ where: { vendorId_userId: { vendorId: vendor.id, userId: foreignUser.id } } }),
    ]);
    const team = await db.salesTeam.create({ data: { vendorId: vendor.id, name: `WP53 Team ${suffix}`, slug: `wp53-team-${suffix}` } });
    const [teamA, teamB] = await Promise.all([
      db.teamMembership.create({ data: { vendorId: vendor.id, teamId: team.id, vendorMemberId: memberA.id, status: "ACTIVE" } }),
      db.teamMembership.create({ data: { vendorId: vendor.id, teamId: team.id, vendorMemberId: memberB.id, status: "ACTIVE" } }),
    ]);
    const [ownWebinar, foreignWebinar] = await Promise.all([
      db.live.create({ data: { vendorId: vendor.id, teamId: team.id, seminarOwnerMembershipId: teamA.id, title: `WP53 Own ${canary}`, slug: `wp53-own-${suffix}`, scheduledAt: new Date("2030-01-01T00:00:00.000Z") } }),
      db.live.create({ data: { vendorId: vendor.id, teamId: team.id, seminarOwnerMembershipId: teamB.id, title: `WP53 Foreign ${canary}`, slug: `wp53-foreign-${suffix}`, scheduledAt: new Date("2030-01-02T00:00:00.000Z") } }),
    ]);
    const template = await db.teamFunnelTemplate.create({ data: { vendorId: vendor.id, teamId: team.id, name: `WP53 Template ${canary}` } });
    const version = await db.teamFunnelTemplateVersion.create({ data: { vendorId: vendor.id, teamId: team.id, templateId: template.id, version: 1, contentOwnerMembershipId: teamA.id, createdByMemberId: memberA.id, headline: `WP53 Headline ${canary}`, ctaLabel: "了解更多" } });
    const source = await db.partnerFunnelPage.create({ data: { vendorId: vendor.id, teamId: team.id, templateVersionId: version.id, promoterMembershipId: teamA.id, contentOwnerMembershipId: teamA.id, liveId: ownWebinar.id, slug: `wp53-source-${suffix}`, headline: `WP53 Headline ${canary}`, ctaLabel: "了解更多" } });
    const snapshot = async () => ({ template: await db.teamFunnelTemplate.findUniqueOrThrow({ where: { id: template.id } }), versions: await db.teamFunnelTemplateVersion.findMany({ where: { templateId: template.id }, orderBy: { version: "asc" } }), page: await db.partnerFunnelPage.findUniqueOrThrow({ where: { id: source.id } }), lives: await db.live.findMany({ where: { id: { in: [ownWebinar.id, foreignWebinar.id] } }, orderBy: { id: "asc" } }) });
    const before = await snapshot();
    await page.goto("/login");
    await page.getByLabel("Email").fill(actor.email);
    await page.getByLabel("密碼").fill(password);
    await page.getByRole("button", { name: "登入" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    const editPath = `/team-templates/${template.id}/edit`;
    const editResponse = await page.goto(editPath);
    expect(editResponse?.status()).toBe(200);
    await expect(page.getByLabel("綁定 webinar")).toContainText(ownWebinar.title);
    await expect(page.getByLabel("綁定 webinar")).not.toContainText(foreignWebinar.title);
    await page.evaluate(({ id, title }) => { const select = document.querySelector<HTMLSelectElement>('select[name="webinarId"]'); if (!select) throw new Error("missing webinar selector"); select.add(new Option(title, id)); select.value = id; select.dispatchEvent(new Event("change", { bubbles: true })); }, { id: foreignWebinar.id, title: foreignWebinar.title });
    page.once("dialog", (dialog) => dialog.accept());
    const responses: number[] = []; page.on("response", (response) => { if (response.request().method() === "POST" && response.request().headers()["next-action"]) responses.push(response.status()); });
    await page.getByRole("button", { name: "發布新版本" }).click();
    await expect(page.getByRole("status")).toHaveText("你沒有管理這個團隊模板的權限，或該資源已不存在。");
    expect(responses).toContain(200);
    await expect.poll(snapshot).toEqual(before);
  } finally {
    // These team-domain FKs deliberately use RESTRICT. Delete synthetic dependants
    // from leaves to roots so failed assertions cannot leave disposable rows behind.
    await db.partnerFunnelPage.deleteMany({ where: { vendorId: vendor.id } });
    await db.teamFunnelTemplateVersion.deleteMany({ where: { vendorId: vendor.id } });
    await db.teamFunnelTemplate.deleteMany({ where: { vendorId: vendor.id } });
    await db.live.deleteMany({ where: { vendorId: vendor.id } });
    await db.teamMembership.deleteMany({ where: { vendorId: vendor.id } });
    await db.vendor.deleteMany({ where: { id: vendor.id } });
    await db.user.deleteMany({ where: { id: { in: [actor.id, foreignUser.id] } } });
    await db.$disconnect();
  }
});
