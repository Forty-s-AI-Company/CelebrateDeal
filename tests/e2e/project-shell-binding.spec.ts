import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/lib/password";
const db = new PrismaClient();
test.use({ trace: "off", screenshot: "off", video: "off" });
test.setTimeout(180_000);
test.afterAll(async () => db.$disconnect());
for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  test(`project shell form completion and switching at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const id = randomUUID(); const password = "SyntheticShellPassword!42";
    const vendor = await db.vendor.create({ data: { name: "Synthetic shell workspace", slug: id, email: `${id}@example.test`, passwordHash: hashPassword(password) } });
    const user = await db.user.create({ data: { email: `owner-${id}@example.test`, name: "Synthetic owner", passwordHash: hashPassword(password), status: "active", memberships: { create: { vendorId: vendor.id, role: "owner", status: "active" } } } });
    try {
      const project = await db.salesProject.create({ data: { vendorId: vendor.id, name: "Browser project", slug: id, mode: "live_course", primaryFlow: "live" } });
      await db.userOnboardingPreference.create({ data: { userId: user.id, vendorId: vendor.id, selectedProjectId: project.id } });
      const product = await db.product.create({ data: { vendorId: vendor.id, name: "Synthetic product", slug: id, priceCents: 1200, isActive: true, fulfillmentTypeConfirmed: true } });
      await db.salesProjectProduct.create({ data: { vendorId: vendor.id, projectId: project.id, productId: product.id } });
      await page.goto("/login");
      await page.getByLabel("Email").fill(user.email);
      await page.getByLabel("密碼").fill(password);
      await page.getByRole("button", { name: "登入", exact: true }).click();
      await expect(page).toHaveURL(/\/dashboard$/u);
      const panel = page.locator('section:visible').filter({ has: page.getByRole('button', { name: /專案上線任務/u }) });
      const next = panel.getByRole('link', { name: /繼續/u });
      await expect(next).toHaveAttribute('href', `/forms/new?projectId=${project.id}`);
      await next.click();
      await page.locator('input[name="name"]').fill('Synthetic browser form');
      await page.locator('input[name="slug"]').fill(`shell-${id}`);
      await page.locator('input[name="headline"]').fill('Synthetic signup');
      await page.getByRole('button', { name: '儲存表單', exact: true }).click();
      await expect(page).toHaveURL(/\/forms$/u);
      // No reload: server-action invalidation must update the parent shell itself.
      await expect(next).toHaveAttribute('href', `/lives/new?projectId=${project.id}`);
      expect(await db.registrationForm.count({ where: { vendorId: vendor.id, projectId: project.id } })).toBe(1);
      const switcher = page.locator('[data-workspace-switcher]:visible');
      await switcher.getByRole('button', { name: /Browser project/u }).click();
      await switcher.getByRole('menuitemradio', { name: /全部專案總覽/u }).click();
      await expect.poll(async () => (await db.userOnboardingPreference.findUniqueOrThrow({ where: { userId_vendorId: { userId: user.id, vendorId: vendor.id } } })).selectedProjectId).toBeNull();
      await expect(page.getByRole('button', { name: /商家上線任務/u }).filter({ visible: true })).toBeVisible();
    } finally {
      await db.vendor.delete({ where: { id: vendor.id } });
      await db.user.delete({ where: { id: user.id } });
    }
  });
}
