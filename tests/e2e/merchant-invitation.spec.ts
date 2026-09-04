import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/lib/password";

const db = new PrismaClient();
const runId = randomUUID().replace(/-/g, "");
const ownerPassword = "Invitation Owner Password 123!";
const ownerEmail = "e2e-invitation-owner-" + runId + "@celebratedeal.local";
const invitedEmail = "e2e-invited-member-" + runId + "@celebratedeal.local";
const foreignMemberEmail = "e2e-foreign-member-" + runId + "@celebratedeal.local";
const fixture = { vendorId: "", ownerId: "", foreignVendorId: "", foreignMemberId: "" };

test.use({ trace: "off", screenshot: "off", video: "off" });

test.beforeAll(async () => {
  const vendor = await db.vendor.create({
    data: {
      name: "E2E Invitation Vendor " + runId,
      slug: "e2e-invitation-vendor-" + runId,
      email: "e2e-invitation-vendor-" + runId + "@celebratedeal.local",
      passwordHash: hashPassword(ownerPassword),
      primaryColor: "#2563eb",
      ctaColor: "#f97316",
      tracking: { create: {} },
    },
  });
  fixture.vendorId = vendor.id;
  const owner = await db.user.create({
    data: {
      email: ownerEmail,
      name: "Invitation Owner",
      passwordHash: hashPassword(ownerPassword),
      status: "active",
      memberships: { create: { vendorId: vendor.id, role: "owner", status: "active" } },
    },
  });
  fixture.ownerId = owner.id;
  const foreignVendor = await db.vendor.create({
    data: {
      name: "E2E Foreign Invitation Vendor " + runId,
      slug: "e2e-foreign-invitation-vendor-" + runId,
      email: "e2e-foreign-invitation-vendor-" + runId + "@celebratedeal.local",
      passwordHash: hashPassword(ownerPassword),
      primaryColor: "#2563eb",
      ctaColor: "#f97316",
      tracking: { create: {} },
    },
  });
  fixture.foreignVendorId = foreignVendor.id;
  const foreignMember = await db.user.create({
    data: {
      email: foreignMemberEmail,
      name: "Foreign Member Canary",
      passwordHash: hashPassword(ownerPassword),
      status: "active",
      memberships: { create: { vendorId: foreignVendor.id, role: "support", status: "active" } },
    },
  });
  fixture.foreignMemberId = foreignMember.id;
});

test.afterAll(async () => {
  const invitedUser = await db.user.findUnique({ where: { email: invitedEmail }, select: { id: true } });
  const userIds = [fixture.ownerId, fixture.foreignMemberId, invitedUser?.id].filter((id): id is string => Boolean(id));
  const vendorIds = [fixture.vendorId, fixture.foreignVendorId].filter(Boolean);
  await db.userSession.deleteMany({ where: { userId: { in: userIds } } });
  await db.passwordResetToken.deleteMany({ where: { userId: { in: userIds } } });
  await db.auditLog.deleteMany({ where: { OR: [{ vendorId: { in: vendorIds } }, { actorId: { in: userIds } }] } });
  await db.vendorMember.deleteMany({ where: { vendorId: { in: vendorIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  await db.vendor.deleteMany({ where: { id: { in: vendorIds } } });
  await db.$disconnect();
});

test("local invitation state records member and mail failure without proving email delivery", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(ownerEmail);
  await page.getByLabel("密碼").fill(ownerPassword);
  await page.getByRole("button", { name: "登入" }).click();
  await expect(page).toHaveURL(/\/dashboard/u);

  await page.goto("/settings/security");
  const invitationForm = page.locator("form").filter({
    has: page.getByRole("button", { name: "寄送邀請 / 重新啟用成員", exact: true }),
  });
  await expect(invitationForm).toHaveCount(1);
  await invitationForm.getByLabel("姓名", { exact: true }).fill("Invited Support Member");
  await invitationForm.getByLabel("Email", { exact: true }).fill(invitedEmail);
  await invitationForm.getByLabel("角色", { exact: true }).selectOption("support");
  await invitationForm.getByRole("button", { name: "寄送邀請 / 重新啟用成員", exact: true }).click();

  await expect(page).toHaveURL(/\/settings\/security\?error=member_invitation$/u);
  await expect(page.getByText("成員已更新，但邀請信寄送失敗，請稍後重新邀請。", { exact: true })).toBeVisible();
  await expect(page.getByText("Foreign Member Canary", { exact: true })).toHaveCount(0);
  await expect(page.getByText(foreignMemberEmail, { exact: true })).toHaveCount(0);

  const invitedUser = await db.user.findUniqueOrThrow({ where: { email: invitedEmail }, select: { id: true } });
  const invitedMember = await db.vendorMember.findUniqueOrThrow({
    where: { vendorId_userId: { vendorId: fixture.vendorId, userId: invitedUser.id } },
  });
  expect(invitedMember).toMatchObject({ vendorId: fixture.vendorId, role: "support", status: "active" });
  expect(await db.vendorMember.count({ where: { userId: invitedUser.id, vendorId: { not: fixture.vendorId } } })).toBe(0);

  const resetTokens = await db.passwordResetToken.findMany({
    where: { userId: invitedUser.id },
    select: { usedAt: true },
  });
  expect(resetTokens).toHaveLength(1);
  expect(resetTokens[0]?.usedAt).not.toBeNull();
});
