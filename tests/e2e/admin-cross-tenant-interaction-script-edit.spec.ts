import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/lib/password";
import { navigateAndAssertDirectUrlGuard } from "./helpers/direct-url-guard";

const db = new PrismaClient();
const password = "Wp42SyntheticPassword!";
test.use({ trace: "off", screenshot: "off", video: "off" });
test.setTimeout(60_000);

test("admin cannot open another vendor interaction-script editor through direct URL navigation", async ({ page }) => {
  const suffix = randomUUID().replace(/-/g, "");
  const own = {
    script: `WP42 Own Script ${suffix}`,
    description: `WP42 own description ${suffix}`,
    role: `WP42 Own Role ${suffix}`,
    title: `WP42 Own Event ${suffix}`,
    message: `WP42 own message ${suffix}`,
    ctaLabel: `WP42 own CTA ${suffix}`,
    ctaUrl: `/wp42-own-${suffix}`,
  };
  const foreign = {
    script: `WP42 Foreign Script ${suffix}`,
    description: `WP42 foreign description ${suffix}`,
    role: `WP42 Foreign Role ${suffix}`,
    title: `WP42 Foreign Event ${suffix}`,
    message: `WP42 foreign message ${suffix}`,
    ctaLabel: `WP42 foreign CTA ${suffix}`,
    ctaUrl: `/wp42-foreign-${suffix}`,
  };
  const [ownerVendor, foreignVendor] = await Promise.all([
    db.vendor.create({ data: { name: `WP42 Owner ${suffix}`, slug: `wp42-owner-${suffix}`, email: `wp42-owner-${suffix}@celebratedeal.test`, passwordHash: hashPassword(password), primaryColor: "#2563eb", ctaColor: "#f97316", tracking: { create: {} } } }),
    db.vendor.create({ data: { name: `WP42 Foreign ${suffix}`, slug: `wp42-foreign-${suffix}`, email: `wp42-foreign-${suffix}@celebratedeal.test`, passwordHash: hashPassword(password), primaryColor: "#2563eb", ctaColor: "#f97316", tracking: { create: {} } } }),
  ]);
  const [user, ownRole, foreignRole] = await Promise.all([
    db.user.create({ data: { email: `wp42-admin-${suffix}@celebratedeal.test`, name: "WP42 Admin", passwordHash: hashPassword(password), status: "active", memberships: { create: { vendorId: ownerVendor.id, role: "admin", status: "active" } } } }),
    db.interactionRole.create({ data: { vendorId: ownerVendor.id, name: own.role, avatarUrl: null, isActive: true, isScheduled: true, roleType: "official" } }),
    db.interactionRole.create({ data: { vendorId: foreignVendor.id, name: foreign.role, avatarUrl: null, isActive: true, isScheduled: true, roleType: "official" } }),
  ]);
  const [ownScript, foreignScript] = await Promise.all([
    db.interactionScript.create({ data: { vendorId: ownerVendor.id, name: own.script, description: own.description, events: { create: { roleId: ownRole.id, eventType: "chat_message", triggerSec: 42, title: own.title, message: own.message, ctaLabel: own.ctaLabel, ctaUrl: own.ctaUrl } } } }),
    db.interactionScript.create({ data: { vendorId: foreignVendor.id, name: foreign.script, description: foreign.description, events: { create: { roleId: foreignRole.id, eventType: "chat_message", triggerSec: 42, title: foreign.title, message: foreign.message, ctaLabel: foreign.ctaLabel, ctaUrl: foreign.ctaUrl } } } }),
  ]);
  const snapshot = async () => Promise.all([
    db.interactionScript.findUniqueOrThrow({ where: { id: ownScript.id } }),
    db.interactionScript.findUniqueOrThrow({ where: { id: foreignScript.id } }),
    db.interactionEvent.findMany({ where: { scriptId: ownScript.id }, orderBy: { id: "asc" } }),
    db.interactionEvent.findMany({ where: { scriptId: foreignScript.id }, orderBy: { id: "asc" } }),
    db.interactionRole.findUniqueOrThrow({ where: { id: ownRole.id } }),
    db.interactionRole.findUniqueOrThrow({ where: { id: foreignRole.id } }),
    db.interactionScript.count({ where: { vendorId: ownerVendor.id } }), db.interactionScript.count({ where: { vendorId: foreignVendor.id } }),
    db.interactionEvent.count({ where: { script: { vendorId: ownerVendor.id } } }), db.interactionEvent.count({ where: { script: { vendorId: foreignVendor.id } } }),
    db.interactionRole.count({ where: { vendorId: ownerVendor.id } }), db.interactionRole.count({ where: { vendorId: foreignVendor.id } }),
  ]);
  try {
    await page.goto("/login");
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("密碼").fill(password);
    await page.getByRole("button", { name: "登入" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    const before = await snapshot();
    const requests: string[] = [];
    page.on("request", (request) => requests.push(request.url()));
    const ownPath = `/interaction-scripts/${ownScript.id}/edit`;
    const ownResponse = await page.goto(ownPath);
    expect(ownResponse?.status()).toBe(200);
    await expect(page).toHaveURL(new RegExp(`${ownPath}$`));
    await expect(page.getByRole("heading", { name: "編輯互動腳本" })).toBeVisible();
    await expect(page.getByLabel("互動腳本名稱")).toHaveValue(own.script);
    await expect(page.getByLabel("第 1 個事件時間")).toHaveValue("00:00:42");
    await expect(page.getByLabel("第 1 個事件訊息內容")).toHaveValue(own.message);
    await expect(page.getByTestId("interaction-timeline-outline-time")).toHaveText("00:00:42");
    await expect(page.getByTestId("interaction-timeline-outline-message")).toHaveText(own.message);
    await expect(page.getByLabel("第 1 個事件角色")).toHaveValue(ownRole.id);
    const ownContent = await page.content();
    for (const value of Object.values(foreign)) {
      await expect(page.getByText(value, { exact: true })).toHaveCount(0);
      expect(ownContent).not.toContain(value);
    }
    const foreignPath = `/interaction-scripts/${foreignScript.id}/edit`;
    const foreignDataCanaries = Object.values(foreign);
    await navigateAndAssertDirectUrlGuard({
      page,
      path: foreignPath,
      routeIdentityCanaries: [foreignScript.id],
      protectedPayloadCanaries: foreignDataCanaries,
      documentCanaries: foreignDataCanaries,
      finalUrl: new RegExp(`${foreignPath}$`),
      transport: {
        kind: "http-not-found",
        status: 404,
      },
      finalStatus: 404,
    });
    await expect(page.getByRole("heading", { name: "編輯互動腳本" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "留言清單" })).toHaveCount(0);
    await expect(page.getByLabel("互動腳本名稱")).toHaveCount(0);
    await expect(page.getByLabel("第 1 個事件時間")).toHaveCount(0);
    await expect(page.getByLabel("第 1 個事件角色")).toHaveCount(0);
    await expect(page.getByLabel("第 1 個事件訊息內容")).toHaveCount(0);
    await expect(page.getByTestId("interaction-timeline-outline-item")).toHaveCount(0);
    const foreignContent = await page.content();
    for (const value of Object.values(foreign)) {
      await expect(page.getByText(value, { exact: true })).toHaveCount(0);
      expect(foreignContent).not.toContain(value);
    }
    await expect(page.locator("body")).not.toContainText(foreignScript.id);
    const externalRequests = requests.filter((url) => /https:\/\/(?!127\.0\.0\.1)|cloudflare|openai|resend|payuni|sentry|posthog/i.test(url));
    expect(externalRequests, `unexpected external request: ${externalRequests.join(", ")}`).toEqual([]);
    await expect.poll(snapshot).toEqual(before);
  } finally {
    await db.vendor.deleteMany({ where: { id: { in: [ownerVendor.id, foreignVendor.id] } } });
    await db.user.deleteMany({ where: { id: user.id } });
    await db.$disconnect();
  }
});
