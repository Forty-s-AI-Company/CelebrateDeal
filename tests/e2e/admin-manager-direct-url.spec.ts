import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/lib/password";

const db = new PrismaClient();
const password = "Wp29SyntheticPassword!";

// This proof uses synthetic credentials only; retaining browser artifacts
// would add no authorization evidence and could retain a session cookie.
test.use({ trace: "off", screenshot: "off", video: "off" });

test("active admin can reach the vendor manager route through direct URL navigation", async ({ page }) => {
  const suffix = randomUUID().replace(/-/g, "");
  const vendor = await db.vendor.create({
    data: {
      name: `WP29 Admin Vendor ${suffix}`,
      slug: `wp29-admin-${suffix}`,
      email: `wp29-admin-${suffix}@celebratedeal.test`,
      passwordHash: hashPassword(password),
      primaryColor: "#2563eb",
      ctaColor: "#f97316",
      tracking: { create: {} },
    },
  });
  const user = await db.user.create({
    data: {
      email: `wp29-admin-user-${suffix}@celebratedeal.test`,
      name: "WP29 Active Admin",
      passwordHash: hashPassword(password),
      status: "active",
      memberships: { create: { vendorId: vendor.id, role: "admin", status: "active" } },
    },
  });
  const productsBefore = await db.product.count({ where: { vendorId: vendor.id } });

  try {
    await page.goto("/login");
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("密碼").fill(password);
    await page.getByRole("button", { name: "登入" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    await page.goto("/products/new");
    await expect(page).toHaveURL(/\/products\/new$/);
    await expect(page.getByRole("heading", { name: "新增商品" })).toBeVisible();
    await expect(page.getByLabel("商品名稱")).toBeVisible();
    await expect(page).not.toHaveURL(/\/(?:mfa|dashboard\?error=insufficient_role)/);
    await expect.poll(() => db.product.count({ where: { vendorId: vendor.id } })).toBe(productsBefore);
  } finally {
    await db.vendor.deleteMany({ where: { id: vendor.id } });
    await db.user.deleteMany({ where: { id: user.id } });
    await db.$disconnect();
  }
});
