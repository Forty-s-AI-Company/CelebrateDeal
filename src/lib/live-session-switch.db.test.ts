import { createHash, randomUUID } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(async () => null) }));

import { POST as REGISTER } from "@/app/api/form-submissions/route";
import { POST as SWITCH } from "@/app/api/live-session-switch/route";
import LiveSessionSwitchPage from "@/app/live-session-switch/page";
import { getDb } from "@/lib/db";
import { ensureFixedSessionAlreadyRegisteredDelivery, isCurrentEmailDeliverySnapshot } from "@/lib/email-delivery";
import { revealEmailDeliveryPayload } from "@/lib/email-delivery-pii";
import { FORM_SUBMISSION_CHAT_SESSION_COOKIE } from "@/lib/form-submission-chat-session";
import { syncLiveSessions } from "@/lib/live-fixed-sessions-store";
import { redeemLiveSessionSwitchToken } from "@/lib/live-session-switch";
import { createLiveSessionSwitchToken, liveSessionSwitchRedemptionId, verifyLiveSessionSwitchToken } from "@/lib/live-session-switch-token";

/**
 * 「更換場次」 links in the already-registered notice (指定場次), against the
 * disposable loopback PostgreSQL. Synthetic vendors only; each is removed with
 * its cascades afterwards.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const APP = "https://live-session-switch.example.test";
const vendorIds: string[] = [];

beforeEach(() => {
  vi.stubEnv("CSRF_SECRET", "live-session-switch-db-secret-longer-than-thirty-two-bytes");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", APP);
});
afterEach(async () => {
  await getDb().vendor.deleteMany({ where: { id: { in: vendorIds.splice(0) } } });
  vi.unstubAllEnvs();
});

async function fixture(label: string) {
  const db = getDb();
  const suffix = `${label}-${randomUUID()}`;
  const vendor = await db.vendor.create({
    data: { name: `Switch ${label}`, slug: `switch-${suffix}`, email: `switch-${suffix}@example.test`, passwordHash: "synthetic-only", timezone: "Asia/Taipei" },
  });
  vendorIds.push(vendor.id);
  const form = await db.registrationForm.create({
    data: {
      vendorId: vendor.id, name: "Form", slug: `switch-form-${suffix}`, headline: "Synthetic",
      fields: [{ key: "name", label: "Name", type: "text", required: true }, { key: "email", label: "Email", type: "email", required: true }],
    },
  });
  const video = await db.video.create({
    data: { vendorId: vendor.id, title: "Recording", sourceType: "url", videoUrl: "https://video.example.test/recording.m3u8", durationSec: 3_600, status: "ready" },
  });
  const live = await db.live.create({
    data: {
      vendorId: vendor.id, formId: form.id, videoId: video.id, title: "Switch sessions", slug: `switch-live-${suffix}`,
      scheduledAt: new Date(Date.now() + 10 * DAY), status: "scheduled", streamMode: "vod", sessionMode: "fixed_sessions",
    },
  });
  const now = new Date();
  await db.$transaction((tx) => syncLiveSessions(tx, {
    vendorId: vendor.id,
    liveId: live.id,
    sessions: [2, 4, 6, 8].map((days) => ({ startAt: new Date(now.getTime() + days * DAY), capacity: 5, status: "open" as const })),
    now,
  }));
  const sessions = await db.liveSession.findMany({ where: { vendorId: vendor.id, liveId: live.id }, orderBy: { startAt: "asc" } });
  return { vendor, form, live, sessions, suffix };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

async function verifiedRegistrant(fx: Fixture, sessionId: string, label: string) {
  const db = getDb();
  await db.liveSession.update({ where: { id: sessionId }, data: { registeredCount: { increment: 1 } } });
  return db.formSubmission.create({
    data: { formId: fx.form.id, liveId: fx.live.id, liveSessionId: sessionId, name: `Lead ${label}`, email: `lead-${label}-${fx.suffix}@example.test`, verificationStatus: "VERIFIED", verifiedAt: new Date() },
  });
}

async function register(fx: Fixture, email: string, liveSessionId: string, cookie?: string) {
  const response = await REGISTER(new Request(`${APP}/api/form-submissions`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: APP, "x-celebratedeal-client": "web", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ formId: fx.form.id, liveId: fx.live.id, liveSessionId, payload: { name: "Synthetic Lead", email } }),
  }));
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

function press(token: string) {
  return SWITCH(new Request(`${APP}/api/live-session-switch`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", origin: APP },
    body: new URLSearchParams({ token }),
  }));
}

/** The registration cookie the switch response sets, as a request Cookie header. */
function cookieFrom(response: Response) {
  const header = response.headers.getSetCookie().find((value) => value.startsWith(`${FORM_SUBMISSION_CHAT_SESSION_COOKIE}=`));
  return header ? header.split(";")[0]! : null;
}

async function openPage(token: string, status?: string) {
  return renderToStaticMarkup(await LiveSessionSwitchPage({ searchParams: Promise.resolve({ token, ...(status ? { status } : {}) }) }));
}

const redemptions = (submissionId: string) => getDb().liveSessionSwitchRedemption.count({ where: { formSubmissionId: submissionId } });
const INVALID = `${APP}/live-session-switch?status=invalid`;

/** The link the real registrant received in the already-registered notice. */
async function noticeToken(fx: Fixture, submissionId: string) {
  const [row] = await getDb().emailDelivery.findMany({
    where: { vendorId: fx.vendor.id, trigger: "fixed_session_already_registered", sourceFormSubmissionId: submissionId },
  });
  const body = revealEmailDeliveryPayload(row!.payloadEncryptedEnvelope, { vendorId: row!.vendorId, deliveryId: row!.id }).body;
  const link = /更換場次：(\S+)/u.exec(body)?.[1];
  expect(link).toBeDefined();
  const url = new URL(link!);
  expect(`${url.origin}${url.pathname}`).toBe(`${APP}/live-session-switch`);
  return { token: url.searchParams.get("token")!, body, sourceTemplateId: row!.sourceTemplateId };
}

describe("「更換場次」 link in the already-registered notice", () => {
  it("switches from a new device: the page GET consumes nothing, one POST gives the cookie, the link then dies", async () => {
    const fx = await fixture("flow");
    const [held, target] = fx.sessions;
    const registrant = await verifiedRegistrant(fx, held!.id, "flow");

    // Someone without the registration cookie asks for another session: the
    // answer is neutral and the real registrant gets the notice with the link.
    expect(await register(fx, registrant.email, target!.id)).toEqual({ status: 200, body: { ok: true, verificationRequired: true } });
    const { token, body, sourceTemplateId } = await noticeToken(fx, registrant.id);
    expect(sourceTemplateId).toBe("system_fixed_session_already_registered_v3");
    expect(body).toContain("如需換場，請在原本報名的裝置上操作");
    expect(body).toContain("24 小時內有效，只能使用一次");
    expect(verifyLiveSessionSwitchToken(token)).toMatchObject({ vendorId: fx.vendor.id, submissionId: registrant.id, sessionId: held!.id });

    // A mail scanner (or the person) opening the page, any number of times, redeems nothing.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const html = await openPage(token);
      expect(html).toContain("確認並前往選擇場次");
      expect(html).toContain('action="/api/live-session-switch"');
      expect(html).toContain('method="post"');
    }
    expect(await redemptions(registrant.id)).toBe(0);

    // The button: this browser now holds the registration's cookie and goes back to register.
    const pressed = await press(token);
    expect(pressed.status).toBe(303);
    expect(pressed.headers.get("location")).toMatch(new RegExp(`^${APP}/(?:lp|form|live)/`, "u"));
    const cookie = cookieFrom(pressed);
    expect(cookie).not.toBeNull();
    expect(await redemptions(registrant.id)).toBe(1);

    // Single use: the same link again is refused and sets no cookie.
    const again = await press(token);
    expect(again.headers.get("location")).toBe(INVALID);
    expect(cookieFrom(again)).toBeNull();
    expect(await redemptions(registrant.id)).toBe(1);
    expect(await openPage(token)).toContain("確認並前往選擇場次"); // the page alone cannot tell; the POST decides

    // With that cookie the same registration form now moves the registration.
    const moved = await register(fx, registrant.email, target!.id, cookie!);
    expect(moved.status).toBe(200);
    expect(moved.body.liveSession).toMatchObject({ id: target!.id });
    const after = await getDb().formSubmission.findUniqueOrThrow({ where: { id: registrant.id }, select: { liveSessionId: true } });
    expect(after.liveSessionId).toBe(target!.id);
    const seats = await getDb().liveSession.findMany({ where: { id: { in: [held!.id, target!.id] } }, orderBy: { startAt: "asc" }, select: { registeredCount: true } });
    expect(seats.map((row) => row.registeredCount)).toEqual([0, 1]);

    // Any other link for the session it left (e.g. an earlier notice) is dead after the switch.
    const earlier = createLiveSessionSwitchToken({ vendorId: fx.vendor.id, submissionId: registrant.id, sessionId: held!.id });
    expect((await press(earlier)).headers.get("location")).toBe(INVALID);
    expect(await redemptions(registrant.id)).toBe(1);
  });

  it("refuses an expired link and a link for a session that already started", async () => {
    const fx = await fixture("expiry");
    const [held] = fx.sessions;
    const registrant = await verifiedRegistrant(fx, held!.id, "expiry");
    const binding = { vendorId: fx.vendor.id, submissionId: registrant.id, sessionId: held!.id };

    const stale = createLiveSessionSwitchToken(binding, new Date(Date.now() - DAY - MINUTE));
    expect(await openPage(stale)).toContain("更換場次連結無效或已過期");
    const pressed = await press(stale);
    expect(pressed.headers.get("location")).toBe(INVALID);
    expect(cookieFrom(pressed)).toBeNull();
    // Valid just before 24 hours, refused at 24 hours.
    const issuedAt = new Date();
    const fresh = createLiveSessionSwitchToken(binding, issuedAt);
    expect(await redeemLiveSessionSwitchToken(fresh, new Date(issuedAt.getTime() + DAY))).toEqual({ ok: false });
    expect(await redemptions(registrant.id)).toBe(0);

    // The held session started: it can no longer be left, so the link is refused.
    await getDb().liveSession.update({ where: { id: held!.id }, data: { startAt: new Date(Date.now() - MINUTE) } });
    expect(await redeemLiveSessionSwitchToken(fresh)).toEqual({ ok: false });
    expect(await redemptions(registrant.id)).toBe(0);
  });

  it("refuses foreign, mismatched and unverified bindings, and the table enforces the vendor", async () => {
    const a = await fixture("tenant-a");
    const b = await fixture("tenant-b");
    const mine = await verifiedRegistrant(a, a.sessions[0]!.id, "mine");
    const theirs = await verifiedRegistrant(b, b.sessions[0]!.id, "theirs");
    const refused = [
      // Another vendor's registration under this vendor's id, and the reverse.
      { vendorId: a.vendor.id, submissionId: theirs.id, sessionId: b.sessions[0]!.id },
      { vendorId: b.vendor.id, submissionId: mine.id, sessionId: a.sessions[0]!.id },
      // The right registration, but a session it does not hold (own Live or another vendor's).
      { vendorId: a.vendor.id, submissionId: mine.id, sessionId: a.sessions[1]!.id },
      { vendorId: a.vendor.id, submissionId: mine.id, sessionId: b.sessions[0]!.id },
    ];
    for (const binding of refused) {
      const response = await press(createLiveSessionSwitchToken(binding));
      expect(response.headers.get("location"), JSON.stringify(binding)).toBe(INVALID);
      expect(cookieFrom(response)).toBeNull();
    }

    // An unverified registration moves freely and never gets this link; a token for one is refused.
    await getDb().liveSession.update({ where: { id: a.sessions[2]!.id }, data: { registeredCount: { increment: 1 } } });
    const pending = await getDb().formSubmission.create({
      data: { formId: a.form.id, liveId: a.live.id, liveSessionId: a.sessions[2]!.id, name: "Pending", email: `pending-${a.suffix}@example.test` },
    });
    expect((await press(createLiveSessionSwitchToken({ vendorId: a.vendor.id, submissionId: pending.id, sessionId: a.sessions[2]!.id }))).headers.get("location")).toBe(INVALID);
    expect(await getDb().liveSessionSwitchRedemption.count({ where: { vendorId: { in: [a.vendor.id, b.vendor.id] } } })).toBe(0);

    // A redemption row can only name a session of the vendor it records (composite FK).
    await expect(getDb().liveSessionSwitchRedemption.create({
      data: { id: liveSessionSwitchRedemptionId("BBBBBBBBBBBBBBBBBBBBBB"), vendorId: b.vendor.id, formSubmissionId: mine.id, liveSessionId: a.sessions[0]!.id, expiresAt: new Date(Date.now() + DAY) },
    })).rejects.toMatchObject({ code: "P2003" });

    // The correct binding still works for each vendor.
    expect(await redeemLiveSessionSwitchToken(createLiveSessionSwitchToken({ vendorId: b.vendor.id, submissionId: theirs.id, sessionId: b.sessions[0]!.id })))
      .toMatchObject({ ok: true, submissionId: theirs.id });
  });

  it("redeems a link once even when pressed concurrently", async () => {
    const fx = await fixture("race");
    const registrant = await verifiedRegistrant(fx, fx.sessions[0]!.id, "race");
    const token = createLiveSessionSwitchToken({ vendorId: fx.vendor.id, submissionId: registrant.id, sessionId: fx.sessions[0]!.id });
    const responses = await Promise.all(Array.from({ length: 5 }, () => press(token)));
    expect(responses.filter((response) => cookieFrom(response) !== null)).toHaveLength(1);
    expect(responses.filter((response) => response.headers.get("location") === INVALID)).toHaveLength(4);
    expect(await redemptions(registrant.id)).toBe(1);
  });

  it("lets a registrant of a cancelled session use the link even after its start, and shows the retry page", async () => {
    const fx = await fixture("cancelled");
    const registrant = await verifiedRegistrant(fx, fx.sessions[0]!.id, "cancelled");
    await getDb().liveSession.update({
      where: { id: fx.sessions[0]!.id },
      data: { status: "cancelled", cancelledAt: new Date(), startAt: new Date(Date.now() - HOUR) },
    });
    const token = createLiveSessionSwitchToken({ vendorId: fx.vendor.id, submissionId: registrant.id, sessionId: fx.sessions[0]!.id });
    const pressed = await press(token);
    expect(cookieFrom(pressed)).not.toBeNull();
    expect(await redemptions(registrant.id)).toBe(1);
    const retry = await openPage(token, "retry");
    expect(retry).toContain("目前較為忙碌，請重試");
    expect(retry).not.toContain("確認並前往選擇場次");
  });
});

describe("the notice keeps working once its link can have expired (review M1)", () => {
  const noticeInput = (fx: Fixture, registrant: { id: string; name: string; email: string }, held: string, target: string) => ({
    vendorId: fx.vendor.id, vendorName: fx.vendor.name, liveId: fx.live.id, liveSlug: fx.live.slug, liveTitle: fx.live.title,
    sessionId: held, sessionLabel: "11/2 20:00", targetSessionId: target,
    formSubmissionId: registrant.id, recipientName: registrant.name, recipientEmail: registrant.email,
  });
  const noticeRows = (fx: Fixture, submissionId: string) => getDb().emailDelivery.findMany({
    where: { vendorId: fx.vendor.id, trigger: "fixed_session_already_registered", sourceFormSubmissionId: submissionId },
    orderBy: { createdAt: "asc" },
  });

  it("sends a fresh link for the same session once its link can have expired, capped at three per rolling 24 hours", async () => {
    const fx = await fixture("window");
    const [held, b, c, d] = fx.sessions;
    const registrant = await verifiedRegistrant(fx, held!.id, "window");
    // One hour into a 24-hour window, so the steps below land in known windows.
    const t0 = new Date(Math.floor(Date.now() / DAY) * DAY + HOUR);
    const send = (target: string, at: Date) => ensureFixedSessionAlreadyRegisteredDelivery(noticeInput(fx, registrant, held!.id, target), at);
    for (const target of [b!, c!, d!]) expect((await send(target.id, t0)).status).toBe("queued");
    expect((await send(b!.id, new Date(t0.getTime() + 2 * HOUR))).status).toBe("duplicate");

    // Next window, but all three are still inside the last 24 hours: capped, nothing sent.
    expect(await send(b!.id, new Date(t0.getTime() + DAY - 30 * MINUTE))).toEqual({ status: "capped", deliveryId: null });
    // A day after the first notice its link has expired: the same session again gets a new notice and link.
    const t1 = new Date(t0.getTime() + DAY + MINUTE);
    expect((await send(b!.id, t1)).status).toBe("queued");

    const rows = await noticeRows(fx, registrant.id);
    expect(rows).toHaveLength(4);
    const tokens = rows.map((row) => /更換場次：(\S+)/u.exec(revealEmailDeliveryPayload(row.payloadEncryptedEnvelope, { vendorId: row.vendorId, deliveryId: row.id }).body)![1]!);
    expect(new Set(tokens).size).toBe(4);
    for (const row of rows) {
      expect(row.idempotencyKey).toMatch(/^fixed-session-already-registered\/[^/]+\/[^/]+\/w\d+\/email_[0-9a-f]{32}$/u);
      expect(await isCurrentEmailDeliverySnapshot(row, t1)).toBe(true);
    }
    // The fresh link works at its own time, while the first one has expired by then.
    const tokenOf = (link: string) => new URL(link).searchParams.get("token")!;
    expect(await redeemLiveSessionSwitchToken(tokenOf(tokens[0]!), t1)).toEqual({ ok: false });
    expect(await redeemLiveSessionSwitchToken(tokenOf(tokens[3]!), t1)).toMatchObject({ ok: true, submissionId: registrant.id });
  });

  it("still sends a notice queued before windows existed (legacy identity)", async () => {
    const fx = await fixture("legacy");
    const [held, target] = fx.sessions;
    const registrant = await verifiedRegistrant(fx, held!.id, "legacy");
    const { deliveryId } = await ensureFixedSessionAlreadyRegisteredDelivery(noticeInput(fx, registrant, held!.id, target!.id));
    const legacyId = `email_${createHash("sha256").update(JSON.stringify([fx.vendor.id, registrant.id, target!.id, "fixed_session_already_registered"])).digest("hex").slice(0, 32)}`;
    const legacy = await getDb().emailDelivery.update({
      where: { id: deliveryId! },
      data: { id: legacyId, idempotencyKey: `fixed-session-already-registered/${held!.id}/${target!.id}/${legacyId}` },
    });
    expect(await isCurrentEmailDeliverySnapshot(legacy)).toBe(true);
    // A forged window on a legacy id does not match.
    expect(await isCurrentEmailDeliverySnapshot({ ...legacy, idempotencyKey: `fixed-session-already-registered/${held!.id}/${target!.id}/w1/${legacyId}` })).toBe(false);
  });
});
