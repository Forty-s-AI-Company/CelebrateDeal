import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/lib/password";

const db = new PrismaClient();
const password = "Wp28SyntheticPassword!";

// The role boundary is the only evidence target. Do not retain credentials in
// traces, screenshots, or videos.
test.use({ trace: "off", screenshot: "off", video: "off" });

test("active accountant is denied the vendor manager route through direct URL navigation", async ({ page }) => {
  const suffix = randomUUID().replace(/-/g, "");
  const vendor = await db.vendor.create({
    data: {
      name: `WP28 Accountant Vendor ${suffix}`,
      slug: `wp28-accountant-${suffix}`,
      email: `wp28-accountant-${suffix}@celebratedeal.test`,
      passwordHash: hashPassword(password),
      primaryColor: "#2563eb",
      ctaColor: "#f97316",
      tracking: { create: {} },
    },
  });
  const user = await db.user.create({
    data: {
      email: `wp28-accountant-user-${suffix}@celebratedeal.test`,
      name: "WP28 Active Accountant",
      passwordHash: hashPassword(password),
      status: "active",
      memberships: { create: { vendorId: vendor.id, role: "accountant", status: "active" } },
    },
  });
  const productsBefore = await db.product.count({ where: { vendorId: vendor.id } });

  try {
    await page.goto("/login");
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("密碼").fill(password);
    await page.getByRole("button", { name: "登入" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

    await page.goto("/products/new");
    await expect(page).toHaveURL(/\/dashboard\?error=insufficient_role$/);
    await expect(page.getByRole("heading", { name: "新增商品" })).toHaveCount(0);
    await expect(page.getByLabel("商品名稱")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect.poll(() => db.product.count({ where: { vendorId: vendor.id } })).toBe(productsBefore);
  } finally {
    await db.vendor.deleteMany({ where: { id: vendor.id } });
    await db.user.deleteMany({ where: { id: user.id } });
    await db.$disconnect();
  }
});
