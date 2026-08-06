import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/lib/password";

const db = new PrismaClient();
const password = "Wp37SyntheticPassword!";

test.use({ trace: "off", screenshot: "off", video: "off" });

test("owner cannot open another vendor message-template edit route through direct URL navigation", async ({ page }) => {
  const suffix = randomUUID().replace(/-/g, "");
  const [ownerVendor, foreignVendor] = await Promise.all([
    db.vendor.create({ data: { name: `WP37 Owner ${suffix}`, slug: `wp37-owner-${suffix}`, email: `wp37-owner-${suffix}@celebratedeal.test`, passwordHash: hashPassword(password), primaryColor: "#2563eb", ctaColor: "#f97316", tracking: { create: {} } } }),
    db.vendor.create({ data: { name: `WP37 Foreign ${suffix}`, slug: `wp37-foreign-${suffix}`, email: `wp37-foreign-${suffix}@celebratedeal.test`, passwordHash: hashPassword(password), primaryColor: "#2563eb", ctaColor: "#f97316", tracking: { create: {} } } }),
  ]);
  const [user, ownTemplate, foreignTemplate] = await Promise.all([
    db.user.create({ data: { email: `wp37-owner-${suffix}@celebratedeal.test`, name: "WP37 Owner", passwordHash: hashPassword(password), status: "active", memberships: { create: { vendorId: ownerVendor.id, role: "owner", status: "active" } } } }),
    db.messageTemplate.create({ data: { vendorId: ownerVendor.id, name: `WP37 Own ${suffix}`, channel: "email", trigger: "registration_confirmed", subject: `WP37 Own Subject ${suffix}`, body: `WP37 own body canary ${suffix}`, isActive: true } }),
    db.messageTemplate.create({ data: { vendorId: foreignVendor.id, name: `WP37 Foreign ${suffix}`, channel: "sms", trigger: "live_reminder", subject: `WP37 Foreign Subject ${suffix}`, body: `WP37 foreign body canary ${suffix}`, isActive: true } }),
  ]);
  const snapshot = async () => Promise.all([
    db.messageTemplate.findUniqueOrThrow({ where: { id: ownTemplate.id } }),
    db.messageTemplate.findUniqueOrThrow({ where: { id: foreignTemplate.id } }),
    db.messageTemplate.count({ where: { vendorId: ownerVendor.id } }),
    db.messageTemplate.count({ where: { vendorId: foreignVendor.id } }),
  ]);
  const before = await snapshot();

  try {
    await page.goto("/login");
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("密碼").fill(password);
    await page.getByRole("button", { name: "登入" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    const ownPath = `/messages/templates/${ownTemplate.id}/edit`;
    const ownResponse = await page.goto(ownPath);
    expect(ownResponse?.status()).toBe(200);
    await expect(page).toHaveURL(new RegExp(`${ownPath}$`));
    await expect(page.getByRole("heading", { name: "編輯訊息模板" })).toBeVisible();
    await expect(page.getByLabel("模板名稱")).toHaveValue(ownTemplate.name);
    await expect(page.getByLabel("渠道")).toHaveValue(ownTemplate.channel);
    await expect(page.getByLabel("觸發條件")).toHaveValue(ownTemplate.trigger);
    await expect(page.getByLabel("主旨")).toHaveValue(ownTemplate.subject ?? "");
    await expect(page.getByLabel("內容")).toHaveValue(ownTemplate.body);

    const foreignPath = `/messages/templates/${foreignTemplate.id}/edit`;
    const foreignResponse = await page.goto(foreignPath);
    expect(foreignResponse?.status()).toBe(404);
    await expect(page).toHaveURL(new RegExp(`${foreignPath}$`));
    await expect(page.getByRole("heading", { name: "編輯訊息模板" })).toHaveCount(0);
    for (const label of ["模板名稱", "渠道", "觸發條件", "主旨", "內容"]) {
      await expect(page.getByLabel(label)).toHaveCount(0);
    }
    for (const value of [foreignTemplate.id, foreignTemplate.name, foreignTemplate.subject ?? "", foreignTemplate.body]) {
      await expect(page.getByText(value, { exact: true })).toHaveCount(0);
    }
    await expect.poll(snapshot).toEqual(before);
  } finally {
    await db.vendor.deleteMany({ where: { id: { in: [ownerVendor.id, foreignVendor.id] } } });
    await db.user.deleteMany({ where: { id: user.id } });
    await db.$disconnect();
  }
});
