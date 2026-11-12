import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/lib/password";

const db = new PrismaClient();
const password = "SyntheticPaletteSecret!42";

test.use({ trace: "off", screenshot: "off", video: "off" });
test.setTimeout(180_000);
test.afterAll(async () => db.$disconnect());

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("密碼").fill(password);
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/u);
}

async function createMember(role: "owner" | "accountant", flow?: "live" | "consultation") {
  const id = randomUUID();
  const vendor = await db.vendor.create({ data: { name: `Synthetic palette ${role}`, slug: id, email: `${id}@example.test`, passwordHash: hashPassword(password) } });
  const user = await db.user.create({ data: { email: `${role}-${id}@example.test`, name: `Synthetic ${role}`, passwordHash: hashPassword(password), status: "active", memberships: { create: { vendorId: vendor.id, role, status: "active" } } } });
  if (flow) {
    const project = await db.salesProject.create({ data: { vendorId: vendor.id, name: "Palette project", slug: id, mode: flow === "live" ? "live_course" : "consulting", primaryFlow: flow } });
    await db.userOnboardingPreference.create({ data: { userId: user.id, vendorId: vendor.id, selectedProjectId: project.id } });
  }
  return { vendor, user };
}

async function cleanup({ vendor, user }: Awaited<ReturnType<typeof createMember>>) {
  await db.vendor.deleteMany({ where: { id: vendor.id } });
  await db.user.deleteMany({ where: { id: user.id } });
}

const sidebar = (page: Page) => page.getByRole("navigation", { name: "主要導覽" });
const groupHeader = (page: Page, name: string) => sidebar(page).getByRole("button", { name, exact: true });
const combobox = (page: Page) => page.getByRole("combobox", { name: "搜尋頁面" });
const options = (page: Page) => page.getByRole("listbox", { name: "頁面" }).getByRole("option");

test("owner on a consultation project: groups start by flow, remember toggles, and the palette opens pages", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const member = await createMember("owner", "consultation");
  try {
    await login(page, member.user.email);

    // Live-only groups start collapsed for a consultation project; the core group stays open.
    await expect(groupHeader(page, "銷講中心")).toHaveAttribute("aria-expanded", "false");
    await expect(groupHeader(page, "互動與行銷")).toHaveAttribute("aria-expanded", "false");
    await expect(groupHeader(page, "夥伴成長")).toHaveAttribute("aria-expanded", "false");
    await expect(groupHeader(page, "成交管理")).toHaveAttribute("aria-expanded", "true");
    await expect(sidebar(page).getByRole("link", { name: "直播間" })).toBeHidden();

    // A toggle survives a reload; the default does not override it.
    await groupHeader(page, "夥伴成長").click();
    await expect(groupHeader(page, "夥伴成長")).toHaveAttribute("aria-expanded", "true");
    await expect(sidebar(page).getByRole("link", { name: "推廣夥伴" })).toBeVisible();
    await page.reload();
    await expect(groupHeader(page, "夥伴成長")).toHaveAttribute("aria-expanded", "true");
    await expect(groupHeader(page, "銷講中心")).toHaveAttribute("aria-expanded", "false");

    // Opening a page in a collapsed group expands that group.
    await page.goto("/lives");
    await expect(groupHeader(page, "銷講中心")).toHaveAttribute("aria-expanded", "true");
    await expect(sidebar(page).getByRole("link", { name: "直播間" })).toHaveAttribute("aria-current", "page");
    await page.goto("/dashboard");
    await expect(groupHeader(page, "銷講中心")).toHaveAttribute("aria-expanded", "false");

    // The visible trigger shows the shortcut and opens the dialog; Escape returns focus to it.
    const trigger = page.getByRole("button", { name: /搜尋頁面/u });
    await expect(trigger).toContainText(/Ctrl K|⌘K/u);
    await trigger.click();
    await expect(combobox(page)).toBeFocused();
    await expect(page.getByRole("dialog", { name: "快速前往頁面" })).toBeVisible();
    const blocking = (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze()).violations
      .filter((violation) => violation.impact === "critical" || violation.impact === "serious")
      .map((violation) => violation.id);
    expect(blocking).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(trigger).toBeFocused();

    // Keyboard: Ctrl+K, filter by Chinese substring, Enter goes to the page.
    await page.keyboard.press("Control+K");
    await expect(combobox(page)).toBeFocused();
    await combobox(page).fill("訂單");
    await expect(options(page).first()).toHaveText(/訂單與履約/u);
    await expect(options(page).first()).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/orders$/u);
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // Arrow keys move the highlighted option; the owner sees owner-only and settings pages.
    await page.keyboard.press("Control+K");
    await combobox(page).fill("設定");
    await expect(options(page).first()).toHaveText(/^設定/u);
    await page.keyboard.press("ArrowDown");
    await expect(options(page).nth(1)).toHaveAttribute("aria-selected", "true");
    await expect(combobox(page)).toHaveAttribute("aria-activedescendant", (await options(page).nth(1).getAttribute("id")) ?? "");
    await combobox(page).fill("LINE");
    await expect(options(page).filter({ hasText: "LINE 整合" })).toHaveCount(1);
    await combobox(page).fill("不存在的頁面名稱");
    await expect(options(page)).toHaveCount(0);
    await expect(page.getByRole("status").filter({ hasText: "找不到符合的頁面" })).toBeVisible();
    await page.keyboard.press("Escape");
  } finally {
    await cleanup(member);
  }
});

test("the palette lists only pages the accountant may open", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const member = await createMember("accountant");
  try {
    await login(page, member.user.email);
    await page.keyboard.press("Control+K");
    await expect(combobox(page)).toBeFocused();
    await expect(options(page).filter({ hasText: "電子發票" }).first()).toBeVisible();
    for (const hidden of ["訂單與履約", "報名管理", "品牌設定", "LINE 整合", "團隊管理"]) {
      await combobox(page).fill(hidden);
      await expect(options(page).filter({ hasText: hidden })).toHaveCount(0);
    }
    await combobox(page).fill("發票");
    await expect(options(page).first()).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/billing\/(invoices|electronic-invoices)$/u);
  } finally {
    await cleanup(member);
  }
});

test("owner sees the owner-only pages in the palette that the accountant does not", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const member = await createMember("owner");
  try {
    await login(page, member.user.email);
    await page.keyboard.press("Control+K");
    for (const visible of ["訂單與履約", "品牌設定", "LINE 整合"]) {
      await combobox(page).fill(visible);
      await expect(options(page).filter({ hasText: visible }).first()).toBeVisible();
    }
  } finally {
    await cleanup(member);
  }
});
