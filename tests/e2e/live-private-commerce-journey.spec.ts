import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/lib/password";
import { formatPrivateInboxDiagnostic } from "../../scripts/private-inbox-diagnostic";
import { startPrivateChatLoopbackIngress } from "../../scripts/live-private-loopback-ingress.mjs";
import { createFormSubmissionChatSessionToken, FORM_SUBMISSION_CHAT_SESSION_COOKIE } from "../../src/lib/form-submission-chat-session";

test.use({ baseURL: "http://127.0.0.1:31044", trace: "off", screenshot: "off", video: "off" });
test.setTimeout(120_000);
test("verified viewer and actual instructor exchange private messages; other viewers and revoked roles cannot read", async ({ browser, page, baseURL }) => {
  // The isolated runner already owns this front port. The full CI suite starts
  // the identical ingress for this journey only; the upstream keeps memory RL.
  const stopIngress = process.env.PRIVATE_COMMERCE_BROWSER_MIRROR ? undefined
    : await startPrivateChatLoopbackIngress({ port: 31044, upstreamPort: Number(process.env.E2E_PORT ?? 31023),
      proof: "celebratedeal-local-playwright-live-chat-ingress-secret-v1" });
  const db = new PrismaClient({ log: [] });
  const suffix = randomUUID(), password = "SyntheticPrivateManagerPassword!";
  const vendor = await db.vendor.create({ data: { name: "合成私訊工作室", slug: `private-browser-${suffix}`,
    email: `vendor-${suffix}@example.test`, passwordHash: hashPassword(password) } });
  const user = await db.user.create({ data: { name: "合成講師", email: `teacher-${suffix}@example.test`,
    passwordHash: hashPassword(password), status: "active", memberships: { create: { vendorId: vendor.id, role: "owner", status: "active" } } } });
  const contexts = [];
  try {
    const video = await db.video.create({ data: { vendorId: vendor.id, title: "合成私訊影片", videoUrl: "https://video.example.test/private.mp4",
      sourceType: "url", status: "ready", durationSec: 600 } });
    const form = await db.registrationForm.create({ data: { vendorId: vendor.id, name: "合成驗證表單", slug: `private-form-${suffix}`,
      headline: "合成報名", fields: [{ key: "name", label: "姓名", type: "text", required: true }, { key: "email", label: "Email", type: "email", required: true }] } });
    const template = await db.messageTemplate.create({ data: { vendorId: vendor.id, name: "合成確認", channel: "email",
      trigger: "registration_confirmed", subject: "{{live_title}} 報名成功", body: "{{name}} {{unsubscribe_url}}", isActive: true } });
    const live = await db.live.create({ data: { vendorId: vendor.id, videoId: video.id, formId: form.id, messageTemplateId: template.id,
      title: "合成私訊場次", slug: `private-live-${suffix}`, scheduledAt: new Date(Date.now() - 30_000), status: "live", streamMode: "vod", replayEnabled: true } });
    const viewers = [];
    for (const name of ["合成觀眾甲", "合成觀眾乙"]) {
      const submission = await db.formSubmission.create({ data: { formId: form.id, liveId: live.id, name,
        email: `viewer-${randomUUID()}@example.test`, verificationStatus: "VERIFIED" } });
      const context = await browser.newContext({ baseURL }); contexts.push(context);
      // Approved synthetic identity handoff. This does not claim external email
      // verification; admission and every private read/write use real routes.
      await context.addCookies([{ name: FORM_SUBMISSION_CHAT_SESSION_COOKIE,
        value: createFormSubmissionChatSessionToken({ submissionId: submission.id, now: new Date() }), url: baseURL!, httpOnly: true, sameSite: "Lax" }]);
      const viewer = await context.newPage();
      await viewer.route("https://video.example.test/**", route => route.abort());
      const admission = viewer.waitForResponse(response => new URL(response.url()).pathname === "/api/live-admission" && response.request().method() === "POST");
      await viewer.goto(`/live/${live.slug}`);
      expect((await admission).status()).toBe(200);
      await viewer.locator("summary").filter({ hasText: "講師私訊" }).click();
      await expect(viewer.getByRole("textbox", { name: "私人訊息" })).toBeEnabled();
      viewers.push({ page: viewer, submission });
    }
    const first = viewers[0]!, second = viewers[1]!;
    await first.page.getByRole("textbox", { name: "私人訊息" }).fill("甲的合成私人問題");
    const viewerPosted = first.page.waitForResponse(response => new URL(response.url()).pathname === "/api/live-chat/private" && response.request().method() === "POST");
    await first.page.getByRole("button", { name: "傳送私訊", exact: true }).click();
    expect((await viewerPosted).status()).toBe(201);
    await expect(first.page.getByRole("region", { name: "講師私訊", exact: true }).getByRole("list").getByText("甲的合成私人問題", { exact: true })).toBeVisible();
    expect(await db.livePrivateChatMessage.count({ where: { vendorId: vendor.id, liveId: live.id, formSubmissionId: first.submission.id } })).toBe(1);
    await second.page.getByRole("button", { name: "重新確認", exact: true }).click();
    await expect(second.page.getByText("尚無私訊。", { exact: true })).toBeVisible();
    await expect(second.page.getByText("甲的合成私人問題", { exact: true })).toHaveCount(0);

    await page.goto("/login");
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("密碼").fill(password);
    await page.getByRole("button", { name: "登入", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    const instructorNavigation = await page.goto(`/lives/${live.id}/chat`);
    try {
      await expect(page.getByRole("button", { name: "合成觀眾甲", exact: true })).toBeVisible();
    } catch (cause) {
      // Inspect only the exact synthetic actor/conversation. Export fixed HTTP
      // status and booleans; no URL, identities, response bodies or raw errors.
      const apiStatus = await page.evaluate(async url => (await fetch(url, { credentials: "same-origin", headers: { "x-celebratedeal-client": "web" } })).status,
        `/api/live-chat/instructor?${new URLSearchParams({ liveId: live.id })}`);
      const persisted = await db.livePrivateChatMessage.count({ where: { vendorId: vendor.id, liveId: live.id, formSubmissionId: first.submission.id } });
      throw new Error(formatPrivateInboxDiagnostic({ navigationStatus: instructorNavigation?.status(), apiStatus,
        privatePage: new URL(page.url()).pathname === `/lives/${live.id}/chat`, messagePersisted: persisted > 0 }), { cause });
    }
    await expect(page.getByText("甲的合成私人問題", { exact: true })).toBeVisible();
    await page.getByRole("textbox", { name: "私人訊息" }).fill("合成講師正式介面回覆");
    const instructorPosted = page.waitForResponse(response => new URL(response.url()).pathname === "/api/live-chat/instructor" && response.request().method() === "POST");
    await page.getByRole("button", { name: "傳送私訊", exact: true }).click();
    expect((await instructorPosted).status()).toBe(201);
    await expect(page.getByRole("region", { name: "講師私訊", exact: true }).getByRole("list").getByText("合成講師正式介面回覆", { exact: true })).toBeVisible();
    await first.page.getByRole("button", { name: "重新確認", exact: true }).click();
    await expect(first.page.getByText("合成講師正式介面回覆", { exact: true })).toBeVisible();
    await first.page.reload();
    await first.page.locator("summary").filter({ hasText: "講師私訊" }).click();
    await expect(first.page.getByText("合成講師正式介面回覆", { exact: true })).toBeVisible();
    const rows = await db.livePrivateChatMessage.findMany({ where: { vendorId: vendor.id } });
    expect(rows).toHaveLength(2);
    expect(rows.every(row => !row.bodyEncrypted.includes("合成"))).toBe(true);
    expect(await db.liveChatMessage.count({ where: { vendorId: vendor.id } })).toBe(0);
    const query = `/api/live-chat/private?${new URLSearchParams({ vendorId: vendor.id, liveId: live.id })}`;
    const read = await first.page.request.get(query, { headers: { origin: baseURL!, "x-celebratedeal-client": "web" } });
    expect(read.status()).toBe(200);
    expect(read.headers()["cache-control"]).toBe("private, no-store");
    const authorized = await read.json() as { csrfToken: string; conversationBinding: string };
    const requestHeaders = { origin: baseURL!, "x-celebratedeal-client": "web" };
    const retryPayload = { vendorId: vendor.id, liveId: live.id, body: "合成精確UUID重送",
      clientMessageId: randomUUID(), csrfToken: authorized.csrfToken, conversationBinding: authorized.conversationBinding };
    const retries = await Promise.all([first.page.request.post("/api/live-chat/private", { headers: requestHeaders, data: retryPayload }),
      first.page.request.post("/api/live-chat/private", { headers: requestHeaders, data: retryPayload })]);
    expect(retries.map(response => response.status()).sort()).toEqual([200, 201]);
    const retryBodies = await Promise.all(retries.map(response => response.json() as Promise<{ id: string }>));
    expect(retryBodies[0]!.id).toBe(retryBodies[1]!.id);
    expect((await first.page.request.post("/api/live-chat/private", { headers: requestHeaders,
      data: { ...retryPayload, body: "同UUID不得替換內容" } })).status()).toBe(409);
    // Drop only the response after a real backend commit. No API result is
    // fabricated: this exercises an uncertain delivery and identity change.
    await first.page.evaluate(() => {
      const original = window.fetch.bind(window);
      let dropNext = true;
      window.fetch = async (input, init) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const drop = dropNext && init?.method === "POST" && new URL(url, location.href).pathname === "/api/live-chat/private";
        if (drop) dropNext = false;
        const response = await original(input, init);
        if (drop) {
          // Keep the real server status, then lose the response at the client
          // boundary. Transport retries cannot accidentally confirm delivery.
          Object.assign(window, { __privateChatFaultStatus: response.status });
          window.fetch = original;
          throw new TypeError("Synthetic response loss after actual server response");
        }
        return response;
      };
    });
    await first.page.getByRole("textbox", { name: "私人訊息" }).fill("甲的回應遺失草稿");
    await first.page.getByRole("button", { name: "傳送私訊", exact: true }).click();
    await expect(first.page.getByRole("region", { name: "講師私訊", exact: true }).getByRole("alert")).toContainText("訊息未確認送達");
    expect(await first.page.evaluate(() => (window as Window & { __privateChatFaultStatus?: number }).__privateChatFaultStatus)).toBe(201);
    await expect.poll(() => db.livePrivateChatMessage.count({ where: { vendorId: vendor.id } })).toBe(4);
    await first.page.context().addCookies([{ name: FORM_SUBMISSION_CHAT_SESSION_COOKIE,
      value: createFormSubmissionChatSessionToken({ submissionId: second.submission.id, now: new Date() }), url: baseURL!, httpOnly: true, sameSite: "Lax" }]);
    expect((await first.page.request.post("/api/live-chat/private", { headers: requestHeaders, data: retryPayload })).status()).toBe(403);
    await first.page.getByRole("button", { name: "重新確認", exact: true }).click();
    await expect(first.page.getByRole("textbox", { name: "私人訊息" })).toHaveValue("");
    await expect(first.page.getByText("甲的合成私人問題", { exact: true })).toHaveCount(0);
    expect(await db.livePrivateChatMessage.count({ where: { formSubmissionId: second.submission.id } })).toBe(0);
    // Restore only the synthetic A identity for its verification-revocation check.
    await first.page.context().addCookies([{ name: FORM_SUBMISSION_CHAT_SESSION_COOKIE,
      value: createFormSubmissionChatSessionToken({ submissionId: first.submission.id, now: new Date() }), url: baseURL!, httpOnly: true, sameSite: "Lax" }]);
    const denied = await first.page.request.post("/api/live-chat/private", { headers: { origin: baseURL!, "x-celebratedeal-client": "web" },
      data: { vendorId: vendor.id, liveId: live.id, body: "不得寫入", clientMessageId: randomUUID(), csrfToken: "invalid", conversationBinding: authorized.conversationBinding } });
    expect(denied.status()).toBe(403);
    const instructorReadUrl = `/api/live-chat/instructor?${new URLSearchParams({ liveId: live.id, submissionId: first.submission.id })}`;
    // Browser fetch carries the real Secure session on loopback. Prove access
    // before revocation so a missing APIRequestContext cookie cannot fake 403.
    const browserInstructorReadStatus = () => page.evaluate(async url => (await fetch(url,
      { credentials: "same-origin", headers: { "x-celebratedeal-client": "web" } })).status, instructorReadUrl);
    expect(await browserInstructorReadStatus()).toBe(200);
    await db.vendorMember.updateMany({ where: { vendorId: vendor.id, userId: user.id }, data: { role: "member" } });
    const revoked = await page.request.get(instructorReadUrl,
      { headers: { origin: baseURL!, "x-celebratedeal-client": "web" } });
    expect(revoked.status()).toBe(403);
    expect(await browserInstructorReadStatus()).toBe(403);
    await db.formSubmission.update({ where: { id: first.submission.id }, data: { verificationStatus: "UNVERIFIED" } });
    expect((await first.page.request.get(query, { headers: { origin: baseURL!, "x-celebratedeal-client": "web" } })).status()).toBe(403);
    expect(await db.livePrivateChatMessage.count({ where: { vendorId: vendor.id } })).toBe(4);
  } finally {
    for (const context of contexts) await context.close();
    await stopIngress?.();
    await db.livePrivateChatMessage.deleteMany({ where: { vendorId: vendor.id } });
    await db.vendor.delete({ where: { id: vendor.id } });
    await db.user.delete({ where: { id: user.id } });
    await db.$disconnect();
  }
});
