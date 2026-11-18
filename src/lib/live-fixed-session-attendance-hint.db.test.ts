import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A2-10 (#634 option b) on the disposable PostgreSQL database: a personal
// watch link of a fixed-session Live (指定場次) makes that browser follow the
// registration's own session. Vendors, Lives, sessions, registrations,
// admissions and watch progress are real; the routes run end to end.
// Synthetic: rate limiting and monitoring. No provider, e-mail or LINE call.
vi.mock("@/lib/rate-limit", async (original) => ({
  ...await original<typeof import("@/lib/rate-limit")>(),
  checkRateLimit: vi.fn(async () => null),
}));
const monitoring = vi.hoisted(() => ({ captureOperationalError: vi.fn() }));
vi.mock("@/lib/monitoring", async (original) => ({
  ...await original<typeof import("@/lib/monitoring")>(),
  captureOperationalError: monitoring.captureOperationalError,
}));

import { POST as admissionPOST } from "@/app/api/live-admission/route";
import { GET as playbackGET } from "@/app/api/live-playback-source/route";
import { GET as watchLinkGET } from "@/app/api/live-watch-link/route";
import { getDb } from "@/lib/db";
import { createFormSubmissionChatSessionToken, FORM_SUBMISSION_CHAT_SESSION_COOKIE } from "@/lib/form-submission-chat-session";
import {
  createLiveAttendanceToken,
  createLiveSessionHintToken,
  liveAttendanceCookieName,
  liveSessionHintCookieName,
  verifyLiveSessionHintToken,
} from "@/lib/live-attendance-cookie";
import { resolveViewerFixedSession } from "@/lib/live-fixed-sessions-store";
import { LIVE_VIEWER_SESSION_COOKIE } from "@/lib/live-quota-admission";
import { createLiveWatchLinkToken } from "@/lib/live-watch-link-token";

vi.setConfig({ testTimeout: 30_000 });

const db = getDb();
const vendorIds: string[] = [];
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const VIDEO_SECONDS = 3_600;
const APP_URL = "https://fixed-hint.example.test";
const fromNow = (ms: number) => new Date(Date.now() + ms);

beforeEach(() => {
  vi.stubEnv("CSRF_SECRET", "fixed-session-hint-disposable-secret-longer-than-32-bytes");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", APP_URL);
  monitoring.captureOperationalError.mockClear();
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await db.vendor.deleteMany({ where: { id: { in: vendorIds.splice(0) } } });
});

type Fixture = Awaited<ReturnType<typeof fixture>>;

/**
 * A publish-ready fixed-session Live with two sessions playing now: `own`
 * started 40 minutes ago, `latest` 10 minutes ago. The public schedule
 * follows the latest playing session, so a browser without the registrant's
 * session goes to `latest` (playback offset about 600 s) and the registrant's
 * own session plays at about 2 400 s.
 */
async function fixture(options: { sessionMode?: "fixed_sessions" | "single" } = {}) {
  const key = randomUUID().slice(0, 12);
  const vendor = await db.vendor.create({
    data: { name: `指定場次提示 ${key}`, slug: `fixed-hint-${key}`, email: `vendor-${key}@example.test`, passwordHash: "synthetic-only", timezone: "Asia/Taipei" },
  });
  vendorIds.push(vendor.id);
  const form = await db.registrationForm.create({
    data: {
      vendorId: vendor.id,
      name: "報名表",
      slug: `fixed-hint-form-${key}`,
      headline: "報名",
      fields: [{ key: "name", label: "姓名", type: "text", required: true }, { key: "email", label: "Email", type: "email", required: true }],
    },
  });
  const video = await db.video.create({
    data: { vendorId: vendor.id, title: "預錄影片", sourceType: "url", videoUrl: "https://media.example.test/fixed-hint.m3u8", durationSec: VIDEO_SECONDS, status: "ready" },
  });
  const confirmation = await db.messageTemplate.create({
    data: { vendorId: vendor.id, name: "報名成功", channel: "email", trigger: "registration_confirmed", subject: "報名成功 {{live_title}}", body: "{{name}} {{live_url}}\n{{unsubscribe_url}}", isActive: true },
  });
  const live = await db.live.create({
    data: {
      vendorId: vendor.id,
      formId: form.id,
      videoId: video.id,
      messageTemplateId: confirmation.id,
      title: "指定場次直播",
      slug: `fixed-hint-live-${key}`,
      scheduledAt: fromNow(10 * DAY),
      status: "scheduled",
      streamMode: "vod",
      sessionMode: options.sessionMode ?? "fixed_sessions",
      sessionRegistrationCutoffMinutes: 0,
    },
  });
  const sessionAt = (startAt: Date) => db.liveSession.create({ data: { vendorId: vendor.id, liveId: live.id, startAt } });
  const own = await sessionAt(fromNow(-40 * MINUTE));
  const latest = await sessionAt(fromNow(-10 * MINUTE));
  return { vendor, form, live, own, latest, sessionAt };
}

async function registrant(fx: Fixture, liveSessionId: string | null, options: { verified?: boolean; liveId?: string } = {}) {
  const verified = options.verified ?? true;
  return db.formSubmission.create({
    data: {
      formId: fx.form.id,
      liveId: options.liveId ?? fx.live.id,
      liveSessionId,
      name: "王小明",
      email: `lead-${randomUUID().slice(0, 8)}@example.test`,
      verificationStatus: verified ? "VERIFIED" : "UNVERIFIED",
      verifiedAt: verified ? fromNow(-DAY) : null,
    },
  });
}

/** Opens the personal watch link and returns the cookies it set, as a browser would send them back. */
async function openLink(fx: Fixture, submissionId: string) {
  const token = createLiveWatchLinkToken({ vendorId: fx.vendor.id, liveId: fx.live.id, submissionId, sessionStartAt: fromNow(-40 * MINUTE) });
  const response = await watchLinkGET(new Request(`${APP_URL}/api/live-watch-link?token=${encodeURIComponent(token)}`));
  expect(response.status).toBe(303);
  return { response, cookies: response.headers.getSetCookie().map((header) => header.split(";")[0]!) };
}

const attendanceCookie = (fx: Fixture, submissionId: string) =>
  `${liveAttendanceCookieName(fx.live.id)}=${createLiveAttendanceToken({ vendorId: fx.vendor.id, liveId: fx.live.id, submissionId, expiresAt: fromNow(DAY) })}`;
const hintCookie = (fx: Fixture, submissionId: string, binding: { vendorId?: string; liveId?: string } = {}) =>
  `${liveSessionHintCookieName(fx.live.id)}=${createLiveSessionHintToken({
    vendorId: binding.vendorId ?? fx.vendor.id, liveId: binding.liveId ?? fx.live.id, submissionId, expiresAt: fromNow(DAY),
  })}`;
const registrationCookie = (submissionId: string) => `${FORM_SUBMISSION_CHAT_SESSION_COOKIE}=${createFormSubmissionChatSessionToken({ submissionId })}`;

const viewerHeaders = (cookies: string[]) => ({
  "content-type": "application/json",
  origin: APP_URL,
  "x-celebratedeal-client": "web",
  cookie: cookies.join("; "),
});

/** POST /api/live-admission; returns the status and the viewer cookie it issued. */
async function admit(fx: Fixture, cookies: string[]) {
  const response = await admissionPOST(new Request(`${APP_URL}/api/live-admission`, {
    method: "POST",
    headers: viewerHeaders(cookies),
    body: JSON.stringify({ vendorId: fx.vendor.id, liveId: fx.live.id }),
  }));
  const viewer = response.headers.getSetCookie().find((header) => header.startsWith(`${LIVE_VIEWER_SESSION_COOKIE}=`));
  return { status: response.status, viewerCookie: viewer ? viewer.split(";")[0]! : null };
}

/** GET /api/live-playback-source after an admission; returns the offset the player starts at. */
async function playbackOffset(fx: Fixture, cookies: string[]) {
  const query = new URLSearchParams({ vendorId: fx.vendor.id, liveId: fx.live.id });
  const response = await playbackGET(new Request(`${APP_URL}/api/live-playback-source?${query}`, { headers: viewerHeaders(cookies) }));
  if (response.status !== 200) return { status: response.status, offset: null };
  const body = await response.json() as { playbackStartSeconds?: number };
  return { status: 200, offset: body.playbackStartSeconds ?? null };
}

function resolve(fx: Fixture, input: { registrationToken?: string | null; sessionHintToken?: string | null }) {
  return resolveViewerFixedSession(db, {
    vendorId: fx.vendor.id,
    liveId: fx.live.id,
    registrationToken: input.registrationToken ?? null,
    sessionHintToken: input.sessionHintToken ?? null,
    durationSeconds: VIDEO_SECONDS,
    now: new Date(),
  });
}

const hintValue = (cookie: string) => cookie.slice(cookie.indexOf("=") + 1);

function progressOf(fx: Fixture, formSubmissionId: string) {
  return db.liveWatchProgress.findUnique({
    where: { vendorId_formSubmissionId: { vendorId: fx.vendor.id, formSubmissionId } },
    select: { watchedSeconds: true, liveId: true },
  });
}

describe("personal watch link of a fixed-session Live (A2-10)", () => {
  it("sets the session hint next to the attendance cookie, site-wide, and never the registration cookie", async () => {
    const fx = await fixture();
    const lead = await registrant(fx, fx.own.id);
    const { response, cookies } = await openLink(fx, lead.id);
    const headers = response.headers.getSetCookie();
    expect(headers).toHaveLength(2);
    expect(headers.some((header) => header.startsWith(`${FORM_SUBMISSION_CHAT_SESSION_COOKIE}=`))).toBe(false);
    const hintName = liveSessionHintCookieName(fx.live.id)!;
    const hint = headers.find((header) => header.startsWith(`${hintName}=`))!;
    expect(hint).toMatch(/; Path=\/(?:;|$)/u);
    expect(hint).toMatch(/HttpOnly/iu);
    expect(hint).toMatch(/SameSite=lax/iu);
    expect(hint).toMatch(/Secure/iu);
    expect(verifyLiveSessionHintToken(decodeURIComponent(hintValue(cookies.find((cookie) => cookie.startsWith(`${hintName}=`))!))))
      .toMatchObject({ vendorId: fx.vendor.id, liveId: fx.live.id, submissionId: lead.id });
    // The attendance cookie keeps its own narrow path.
    expect(headers.find((header) => header.startsWith(`${liveAttendanceCookieName(fx.live.id)}=`))).toMatch(/; Path=\/api\/live-admission(?:;|$)/u);
  });

  it("leaves a Live without fixed sessions exactly as before: the attendance cookie only", async () => {
    const fx = await fixture({ sessionMode: "single" });
    const lead = await registrant(fx, null);
    const { response } = await openLink(fx, lead.id);
    expect(response.headers.getSetCookie()).toHaveLength(1);
    expect(response.headers.getSetCookie()[0]!.startsWith(`${liveAttendanceCookieName(fx.live.id)}=`)).toBe(true);
  });

  it("admits the link's device to the registrant's own session, plays it from its own offset, and accumulates watch progress", async () => {
    const fx = await fixture();
    const lead = await registrant(fx, fx.own.id);
    const { cookies } = await openLink(fx, lead.id);

    const first = await admit(fx, cookies);
    expect(first.status).toBe(200);
    expect(await progressOf(fx, lead.id)).toMatchObject({ watchedSeconds: 0, liveId: fx.live.id });
    // The player starts in the registrant's own session (about 40 minutes in), not the latest one (about 10).
    const own = await playbackOffset(fx, [...cookies, first.viewerCookie!]);
    expect(own.status).toBe(200);
    expect(own.offset).toBeGreaterThan(40 * 60 - 30);
    expect(own.offset).toBeLessThan(40 * 60 + 30);

    // The next renewal, 30 seconds later on the database clock, adds those 30 seconds.
    await db.$executeRaw`
      UPDATE "LiveWatchProgress"
      SET "firstCreditedAt" = "firstCreditedAt" - interval '30 seconds', "lastCreditedAt" = "lastCreditedAt" - interval '30 seconds'
      WHERE "vendorId" = ${fx.vendor.id} AND "formSubmissionId" = ${lead.id}`;
    expect((await admit(fx, [...cookies, first.viewerCookie!])).status).toBe(200);
    const progress = await progressOf(fx, lead.id);
    expect(progress!.watchedSeconds).toBeGreaterThanOrEqual(30);
    expect(progress!.watchedSeconds).toBeLessThan(45);
  });

  it("without the hint (a link opened before A2-10) still follows the public schedule and credits nothing", async () => {
    const fx = await fixture();
    const lead = await registrant(fx, fx.own.id);
    const attendanceOnly = [attendanceCookie(fx, lead.id)];
    const admitted = await admit(fx, attendanceOnly);
    expect(admitted.status).toBe(200);
    const offset = await playbackOffset(fx, [...attendanceOnly, admitted.viewerCookie!]);
    expect(offset.offset).toBeGreaterThan(10 * 60 - 30);
    expect(offset.offset).toBeLessThan(10 * 60 + 30);
    // Attendance is recorded as before (Q-17); watch time only for the registrant's own session (#647 MINOR-1).
    await expect(db.liveRegistrationAttendance.count({ where: { vendorId: fx.vendor.id, formSubmissionId: lead.id } })).resolves.toBe(1);
    expect(await progressOf(fx, lead.id)).toBeNull();
  });

  it("opens nothing early: the registrant's own session still waiting means no admission, even while another session plays", async () => {
    const fx = await fixture();
    const upcoming = await fx.sessionAt(fromNow(2 * HOUR));
    const lead = await registrant(fx, upcoming.id);
    const { cookies } = await openLink(fx, lead.id);
    expect(await resolve(fx, { sessionHintToken: decodeURIComponent(hintValue(cookies.find((cookie) => cookie.startsWith(liveSessionHintCookieName(fx.live.id)!))!)) }))
      .toMatchObject({ id: upcoming.id, registered: true });
    expect((await admit(fx, cookies)).status).toBe(404);
    // The public schedule (no cookies) is unaffected.
    expect((await admit(fx, [])).status).toBe(200);
    expect(await progressOf(fx, lead.id)).toBeNull();
  });

  it("follows the registration's current session after a switch, never the one it held when the link was opened", async () => {
    const fx = await fixture();
    const lead = await registrant(fx, fx.own.id);
    const { cookies } = await openLink(fx, lead.id);
    expect((await admit(fx, cookies)).status).toBe(200);
    // The registrant switches to a later session: the old (still playing) one no longer admits this device.
    const later = await fx.sessionAt(fromNow(DAY));
    await db.formSubmission.update({ where: { id: lead.id }, data: { liveSessionId: later.id } });
    expect((await admit(fx, cookies)).status).toBe(404);
    // Switching to the session playing latest admits again, at that session's offset.
    await db.formSubmission.update({ where: { id: lead.id }, data: { liveSessionId: fx.latest.id } });
    const admitted = await admit(fx, cookies);
    expect(admitted.status).toBe(200);
    const offset = await playbackOffset(fx, [...cookies, admitted.viewerCookie!]);
    expect(offset.offset).toBeLessThan(10 * 60 + 30);
  });

  it("a cancelled own session never plays, and is not swapped for the public schedule", async () => {
    const fx = await fixture();
    const lead = await registrant(fx, fx.own.id);
    const { cookies } = await openLink(fx, lead.id);
    await db.liveSession.update({ where: { id: fx.own.id }, data: { status: "cancelled", cancelledAt: new Date() } });
    const hint = decodeURIComponent(hintValue(cookies.find((cookie) => cookie.startsWith(liveSessionHintCookieName(fx.live.id)!))!));
    expect(await resolve(fx, { sessionHintToken: hint })).toMatchObject({ id: fx.own.id, status: "cancelled", registered: true });
    expect((await admit(fx, cookies)).status).toBe(404);
    expect(await progressOf(fx, lead.id)).toBeNull();
  });

  it("falls back to the public schedule for a registration that is no longer VERIFIED or was deleted (existing rules)", async () => {
    const fx = await fixture();
    const lead = await registrant(fx, fx.own.id);
    const hint = hintValue(hintCookie(fx, lead.id));
    await db.formSubmission.update({ where: { id: lead.id }, data: { verificationStatus: "UNVERIFIED" } });
    expect(await resolve(fx, { sessionHintToken: hint })).toMatchObject({ id: fx.latest.id, registered: false });
    await db.formSubmission.delete({ where: { id: lead.id } });
    expect(await resolve(fx, { sessionHintToken: hint })).toMatchObject({ id: fx.latest.id, registered: false });
  });

  it("binds every id to this vendor and Live: another vendor's or Live's hint, a tampered or attendance-only value pick no session", async () => {
    const fx = await fixture();
    const other = await fixture();
    const sibling = await fixture();
    const lead = await registrant(fx, fx.own.id);
    const foreignLead = await registrant(other, other.own.id);
    const siblingLead = await registrant(sibling, sibling.own.id);
    // A registration row of this Live whose form belongs to another vendor.
    const foreignForm = await db.formSubmission.create({
      data: { formId: other.form.id, liveId: fx.live.id, liveSessionId: fx.own.id, name: "他店", email: `foreign-${randomUUID().slice(0, 8)}@example.test`, verificationStatus: "VERIFIED", verifiedAt: fromNow(-DAY) },
    });
    const genuine = hintValue(hintCookie(fx, lead.id));
    const [version, payload, signature] = genuine.split(".");
    const cases: Array<[string, string]> = [
      // Another vendor's hint (its own Live and registration) presented for this Live.
      ["foreign vendor", hintValue(hintCookie(other, foreignLead.id))],
      // This Live's id with another vendor's id, or another Live of the same kind.
      ["vendor swapped", hintValue(hintCookie(fx, lead.id, { vendorId: other.vendor.id }))],
      ["other live", hintValue(hintCookie(sibling, siblingLead.id))],
      // A genuine binding naming a registration of another Live or another vendor's form.
      ["registration of another Live", hintValue(hintCookie(fx, siblingLead.id))],
      ["registration through another vendor's form", hintValue(hintCookie(fx, foreignForm.id))],
      // Altered signature or claims, and the attendance cookie's value.
      ["tampered signature", `${version}.${payload}.${signature!.slice(0, -2)}${signature!.endsWith("AA") ? "BB" : "AA"}`],
      ["tampered claims", `${version}.${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload!, "base64url").toString("utf8")) as object, s: siblingLead.id })).toString("base64url")}.${signature}`],
      ["attendance token", hintValue(attendanceCookie(fx, lead.id))],
    ];
    for (const [name, token] of cases) {
      expect(await resolve(fx, { sessionHintToken: token }), name).toMatchObject({ id: fx.latest.id, registered: false });
    }
    // Through the routes: a forged hint sends the device to the public session and credits nobody.
    const forged = `${liveSessionHintCookieName(fx.live.id)}=${cases[5]![1]}`;
    const admitted = await admit(fx, [attendanceCookie(fx, lead.id), forged]);
    expect(admitted.status).toBe(200);
    const offset = await playbackOffset(fx, [forged, admitted.viewerCookie!]);
    expect(offset.offset).toBeLessThan(10 * 60 + 30);
    expect(await progressOf(fx, lead.id)).toBeNull();
    await expect(db.liveWatchProgress.count({ where: { vendorId: { in: [other.vendor.id, sibling.vendor.id] } } })).resolves.toBe(0);
  });

  it("lets a valid registration cookie win over the hint, as before", async () => {
    const fx = await fixture();
    const owner = await registrant(fx, fx.latest.id);
    const forwarded = await registrant(fx, fx.own.id);
    const cookies = [registrationCookie(owner.id), attendanceCookie(fx, forwarded.id), hintCookie(fx, forwarded.id)];
    expect(await resolve(fx, { registrationToken: createFormSubmissionChatSessionToken({ submissionId: owner.id }), sessionHintToken: hintValue(cookies[2]!) }))
      .toMatchObject({ id: fx.latest.id, registered: true });
    const admitted = await admit(fx, cookies);
    expect(admitted.status).toBe(200);
    // The registration cookie's registration is credited; the forwarded one is not.
    expect(await progressOf(fx, owner.id)).toMatchObject({ watchedSeconds: 0 });
    expect(await progressOf(fx, forwarded.id)).toBeNull();
    // A registration cookie of another Live does not hide the hint.
    const sibling = await fixture();
    const siblingLead = await registrant(sibling, sibling.own.id);
    expect(await resolve(fx, { registrationToken: createFormSubmissionChatSessionToken({ submissionId: siblingLead.id }), sessionHintToken: hintValue(cookies[2]!) }))
      .toMatchObject({ id: fx.own.id, registered: true });
  });
});
