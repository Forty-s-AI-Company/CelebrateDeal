import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { Page } from "@playwright/test";
import { hashPassword } from "../../src/lib/password";

/**
 * Synthetic Live Studio tenant that mirrors the 2026-10-29 staging report:
 * one ready Cloudflare Stream VOD (33:41), one confirmed product, a valid
 * registration form, a registration email and a published 13-event script
 * (scripted roles, product spotlights at 300/900/1800s and an absolute CTA).
 * Everything lives in the disposable loopback QA database only.
 */
export async function createLiveStudioFixture(db: PrismaClient) {
  const id = randomUUID();
  const password = `SyntheticLiveStudio!${id.slice(0, 8)}`;
  const vendor = await db.vendor.create({ data: {
    name: "合成原型食物工作室",
    slug: `live-studio-${id}`,
    email: `${id}@example.test`,
    passwordHash: hashPassword(password),
  } });
  const user = await db.user.create({ data: {
    email: `owner-${id}@example.test`,
    name: "合成店主",
    passwordHash: hashPassword(password),
    status: "active",
    memberships: { create: { vendorId: vendor.id, role: "owner", status: "active" } },
  } });
  const video = await db.video.create({ data: {
    vendorId: vendor.id,
    title: "合成原型食物講座影片",
    sourceType: "cloudflare_stream",
    status: "ready",
    cloudflareReadyToStream: true,
    cloudflareStreamUid: `synthetic-${id}`,
    videoUrl: `https://video.example.test/${id}.m3u8`,
    durationSec: 33 * 60 + 41,
  } });
  const product = await db.product.create({ data: {
    vendorId: vendor.id,
    name: "合成原型食物餐盒",
    slug: `whole-food-box-${id}`,
    priceCents: 129_000,
    inventory: 20,
    isActive: true,
    fulfillmentTypeConfirmed: true,
    fulfillmentType: "physical",
    commerceDomain: "merchant",
  } });
  const form = await db.registrationForm.create({ data: {
    vendorId: vendor.id,
    name: "合成報名表",
    slug: `whole-food-form-${id}`,
    headline: "合成報名",
    fields: [
      { key: "name", label: "姓名", type: "text", required: true },
      { key: "email", label: "Email", type: "email", required: true },
    ],
  } });
  const template = await db.messageTemplate.create({ data: {
    vendorId: vendor.id,
    name: "合成報名成功信",
    channel: "email",
    trigger: "registration_confirmed",
    subject: "{{live_title}} 報名成功",
    body: "{{name}} {{unsubscribe_url}}",
    isActive: true,
  } });
  const [host, guest] = await Promise.all([
    db.interactionRole.create({ data: { vendorId: vendor.id, name: "合成主持人", label: "官方", isScheduled: true } }),
    db.interactionRole.create({ data: { vendorId: vendor.id, name: "合成觀眾", label: "客服助手", roleType: "support", isScheduled: true } }),
  ]);
  const script = await db.interactionScript.create({ data: {
    vendorId: vendor.id,
    name: "合成 13 事件腳本",
    status: "published",
    events: { create: [
      ...[60, 120, 240, 420, 600, 840, 1200, 1500, 1700].map((triggerSec, index) => ({
        eventType: "chat_message",
        triggerSec,
        title: `合成發言 ${index + 1}`,
        message: `合成訊息 ${index + 1}`,
        roleId: index % 2 === 0 ? host.id : guest.id,
      })),
      ...[300, 900, 1800].map((triggerSec) => ({
        eventType: "product_spotlight",
        triggerSec,
        title: "合成商品浮窗",
        productId: product.id,
      })),
      {
        eventType: "cta_switch",
        triggerSec: 1900,
        title: "合成 CTA",
        ctaLabel: "立即購買",
        ctaUrl: `https://example.test/checkout/${id}`,
      },
    ] },
  } });
  return { id, password, vendor, user, video, product, form, template, script };
}

export type LiveStudioFixture = Awaited<ReturnType<typeof createLiveStudioFixture>>;

export async function deleteLiveStudioFixture(db: PrismaClient, fixture: LiveStudioFixture | undefined) {
  if (!fixture) return;
  await db.vendor.delete({ where: { id: fixture.vendor.id } });
  await db.user.delete({ where: { id: fixture.user.id } });
}

export async function loginLiveStudioOwner(page: Page, fixture: LiveStudioFixture) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(fixture.user.email);
  await page.getByLabel("密碼").fill(fixture.password);
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await page.waitForURL(/\/dashboard$/u);
}

/** Fills all eight steps with the reported staging state and stops on step 8. */
export async function fillReportedLiveStudioState(page: Page, fixture: LiveStudioFixture, slug: string) {
  const next = () => page.getByRole("button", { name: "下一步", exact: true }).click();
  await page.getByLabel("直播標題").fill("我吃原型食物就好!?");
  await page.getByLabel("直播網址").fill(slug);
  await page.getByLabel("直播說明").fill("合成說明：原型食物入門。");
  await next();
  await page.locator("select[name=streamMode]").selectOption("vod");
  await page.locator("select[name=videoId]").selectOption(fixture.video.id);
  await next();
  await page.getByRole("checkbox", { name: /合成原型食物餐盒/u }).check();
  await page.getByLabel("促銷短句").fill("直播限定原型食物優惠");
  await next();
  await page.locator("select[name=formId]").selectOption(fixture.form.id);
  await next();
  await page.getByLabel(/^開播時間/u).fill("2026-11-29T20:00");
  await page.getByLabel("直播結束後允許回放").check();
  await page.getByLabel(/^回放觀看期限/u).fill("2026-12-15T23:59");
  await next();
  await page.locator("select[name=messageTemplateId]").selectOption(fixture.template.id);
  await next();
  await page.locator("select[name=interactionScriptId]").selectOption(fixture.script.id);
  await next();
}
