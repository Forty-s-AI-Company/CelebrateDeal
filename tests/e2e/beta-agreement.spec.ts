import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/lib/password";
import { BETA_AGREEMENT_VERSION } from "../../src/lib/beta-agreement-content";
import { acceptBetaAgreementInBrowser } from "./helpers/beta-agreement";

// O-11 封測合作協議 gate. This spec never seeds an acceptance: every vendor
// starts without one and only the owner's click in the dialog records it.
const db = new PrismaClient();
const password = "BetaAgreementSyntheticPassword!";

test.use({ trace: "off", screenshot: "off", video: "off" });
test.setTimeout(120_000);
test.afterAll(async () => db.$disconnect());

async function tenant(tag: string) {
  const vendor = await db.vendor.create({
    data: { name: `封測商家 ${tag}`, slug: `beta-agreement-${tag}`, email: `beta-agreement-${tag}@celebratedeal.test`, passwordHash: hashPassword(password), tracking: { create: {} } },
  });
  const member = async (role: string) => db.user.create({
    data: {
      email: `beta-${role}-${tag}@celebratedeal.test`, name: `Beta ${role}`, passwordHash: hashPassword(password), status: "active",
      memberships: { create: { vendorId: vendor.id, role, status: "active" } },
    },
  });
  return { vendor, owner: await member("owner"), admin: await member("admin") };
}

async function cleanup(vendorIds: string[], emails: string[]) {
  await db.auditLog.deleteMany({ where: { vendorId: { in: vendorIds } } });
  await db.vendor.deleteMany({ where: { id: { in: vendorIds } } });
  await db.user.deleteMany({ where: { email: { in: emails } } });
}

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("密碼").fill(password);
  await page.getByRole("button", { name: "登入", exact: true }).click();
}

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  test(`owner reads and accepts before the back office; members wait (${viewport.width}px)`, async ({ browser }) => {
    const tag = randomUUID().replaceAll("-", "");
    const a = await tenant(`a-${tag}`);
    const b = await tenant(`b-${tag}`);
    const emails = [a.owner.email, a.admin.email, b.owner.email, b.admin.email];
    const ownerContext = await browser.newContext({ viewport });
    const adminContext = await browser.newContext({ viewport });
    try {
      // An admin of A waits for the owner: no accept control, and a direct URL is held too.
      const adminPage = await adminContext.newPage();
      await login(adminPage, a.admin.email);
      await expect(adminPage).toHaveURL(/\/beta-agreement(?:\?|$)/u);
      const waiting = adminPage.getByRole("dialog", { name: "等待商家 owner 同意封測合作協議" });
      await expect(waiting).toBeVisible();
      await expect(waiting.getByRole("checkbox")).toHaveCount(0);
      await adminPage.goto("/orders");
      await expect(adminPage).toHaveURL(/\/beta-agreement(?:\?|$)/u);

      // The owner of A sees the full text with A's name and account as 乙方.
      const ownerPage = await ownerContext.newPage();
      await login(ownerPage, a.owner.email);
      await expect(ownerPage).toHaveURL(/\/beta-agreement(?:\?|$)/u);
      const dialog = ownerPage.getByRole("dialog", { name: "CelebrateDeal 封測合作協議" });
      await expect(dialog.locator("[data-beta-agreement-party]")).toHaveText(`${a.vendor.name}（帳號 Email：${a.owner.email}）`);
      await expect(dialog.getByText("以新台幣 3,000 元為上限")).toBeAttached();
      await expect(dialog.locator(`[data-beta-agreement-version="${BETA_AGREEMENT_VERSION}"]`)).toBeAttached();
      // The page never scrolls sideways on a phone; the text scrolls inside the dialog.
      expect(await ownerPage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
      // Escape does not dismiss the gate.
      await ownerPage.keyboard.press("Escape");
      await expect(dialog).toBeVisible();

      await acceptBetaAgreementInBrowser(ownerPage);
      await expect(ownerPage).toHaveURL(/\/dashboard$/u);
      expect(await db.userPolicyConsent.findMany({ where: { vendorId: a.vendor.id }, select: { userId: true, context: true, agreementVersion: true } }))
        .toEqual([{ userId: a.owner.id, context: "beta_agreement", agreementVersion: BETA_AGREEMENT_VERSION }]);
      await ownerPage.goto("/beta-agreement");
      await expect(ownerPage).toHaveURL(/\/dashboard$/u);

      // A's admin is in now; B (another tenant) is still held.
      await adminPage.goto("/orders");
      await expect(adminPage).toHaveURL(/\/orders$/u);
      const otherOwner = await browser.newContext({ viewport });
      try {
        const otherPage = await otherOwner.newPage();
        await login(otherPage, b.owner.email);
        await expect(otherPage).toHaveURL(/\/beta-agreement(?:\?|$)/u);
      } finally {
        await otherOwner.close();
      }
      expect(await db.userPolicyConsent.count({ where: { vendorId: b.vendor.id } })).toBe(0);
    } finally {
      await ownerContext.close();
      await adminContext.close();
      await cleanup([a.vendor.id, b.vendor.id], emails);
    }
  });
}

test("the public page shows the same version and text without recording anything", async ({ page }) => {
  await page.goto("/policies/beta-agreement");
  await expect(page.getByRole("heading", { level: 1, name: "CelebrateDeal 封測合作協議" })).toBeVisible();
  await expect(page.locator(`[data-beta-agreement-version="${BETA_AGREEMENT_VERSION}"]`)).toBeVisible();
  await expect(page.getByText("本協議以乙方在本平台勾選同意的方式簽署")).toBeVisible();
  await expect(page.getByRole("checkbox")).toHaveCount(0);
});
