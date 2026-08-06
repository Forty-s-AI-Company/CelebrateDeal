import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/lib/password";

const db = new PrismaClient();
const password = "Wp38SyntheticPassword!";

test.use({ trace: "off", screenshot: "off", video: "off" });

test("owner receives only its vendor blacklist entries from the blacklist index", async ({ page }) => {
  const suffix = randomUUID().replace(/-/g, "");
  const [ownerVendor, foreignVendor] = await Promise.all([
    db.vendor.create({ data: { name: `WP38 Owner ${suffix}`, slug: `wp38-owner-${suffix}`, email: `wp38-owner-${suffix}@celebratedeal.test`, passwordHash: hashPassword(password), primaryColor: "#2563eb", ctaColor: "#f97316", tracking: { create: {} } } }),
    db.vendor.create({ data: { name: `WP38 Foreign ${suffix}`, slug: `wp38-foreign-${suffix}`, email: `wp38-foreign-${suffix}@celebratedeal.test`, passwordHash: hashPassword(password), primaryColor: "#2563eb", ctaColor: "#f97316", tracking: { create: {} } } }),
  ]);
  const [user, ownBlacklist, foreignBlacklist] = await Promise.all([
    db.user.create({ data: { email: `wp38-owner-${suffix}@celebratedeal.test`, name: "WP38 Owner", passwordHash: hashPassword(password), status: "active", memberships: { create: { vendorId: ownerVendor.id, role: "owner", status: "active" } } } }),
    db.blacklist.create({ data: { vendorId: ownerVendor.id, identifier: `wp38-own-identifier-${suffix}`, identifierType: "visitor_id", reason: `WP38 own reason ${suffix}`, notes: `WP38 own notes ${suffix}`, isActive: true } }),
    db.blacklist.create({ data: { vendorId: foreignVendor.id, identifier: `wp38-foreign-identifier-${suffix}`, identifierType: "visitor_id", reason: `WP38 foreign reason ${suffix}`, notes: `WP38 foreign notes ${suffix}`, isActive: true } }),
  ]);
  const snapshot = async () => Promise.all([
    db.blacklist.findUniqueOrThrow({ where: { id: ownBlacklist.id } }),
    db.blacklist.findUniqueOrThrow({ where: { id: foreignBlacklist.id } }),
    db.blacklist.count({ where: { vendorId: ownerVendor.id } }),
    db.blacklist.count({ where: { vendorId: foreignVendor.id } }),
  ]);
  const before = await snapshot();

  try {
    await page.goto("/login");
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("密碼").fill(password);
    await page.getByRole("button", { name: "登入" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    const response = await page.goto("/blacklists");
    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL(/\/blacklists$/);
    await expect(page.getByRole("heading", { name: "黑名單管理" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "新增封鎖項目" })).toBeVisible();
    await expect(page.getByText(ownBlacklist.identifier, { exact: true })).toBeVisible();
    await expect(page.getByText(ownBlacklist.reason, { exact: true })).toBeVisible();
    await expect(page.getByText(ownBlacklist.identifierType, { exact: true })).toBeVisible();
    await expect(page.getByText("封鎖中", { exact: true })).toBeVisible();
    await expect(page.getByText("顯示 1 筆黑名單", { exact: true })).toBeAttached();
    await expect(page.locator(`input[name="id"][value="${ownBlacklist.id}"]`)).toHaveCount(1);

    for (const value of [foreignBlacklist.identifier, foreignBlacklist.reason, foreignBlacklist.notes ?? "", foreignBlacklist.id]) {
      await expect(page.getByText(value, { exact: true })).toHaveCount(0);
    }
    await expect(page.locator(`input[name="id"][value="${foreignBlacklist.id}"]`)).toHaveCount(0);
    const documentContent = await page.content();
    for (const value of [foreignBlacklist.identifier, foreignBlacklist.reason, foreignBlacklist.notes ?? "", foreignBlacklist.id]) {
      expect(documentContent).not.toContain(value);
    }
    await expect.poll(snapshot).toEqual(before);
  } finally {
    await db.vendor.deleteMany({ where: { id: { in: [ownerVendor.id, foreignVendor.id] } } });
    await db.user.deleteMany({ where: { id: user.id } });
    await db.$disconnect();
  }
});
