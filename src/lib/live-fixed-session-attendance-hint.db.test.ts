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

async function resolve(fx: Fixture, input: { registrationToken?: string | null; sessionHintToken?: string | null }) {
  // The Live row as it is now, as every viewer path reads it per request.
  const live = await db.live.findUniqueOrThrow({ where: { id: fx.live.id }, include: { video: true } });
  return resolveViewerFixedSession(db, {
    vendorId: fx.vendor.id,
    liveId: fx.live.id,
    registrationToken: input.registrationToken ?? null,
    sessionHintToken: input.sessionHintToken ?? null,
    live,
    now: new Date(),
  });
}

const hintValue = (cookie: string) => cookie.slice(cookie.indexOf("=") + 1);
/** The session-hint value among the cookies a watch link set. */
const hintOf = (fx: Fixture, cookies: string[]) =>
  decodeURIComponent(hintValue(cookies.find((cookie) => cookie.startsWith(`${liveSessionHintCookieName(fx.live.id)}=`))!));

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
    const value = decodeURIComponent(hintValue(cookies.find((cookie) => cookie.startsWith(`${hintName}=`))!));
    expect(verifyLiveSessionHintToken(value, { vendorId: fx.vendor.id, liveId: fx.live.id })).toMatchObject({ submissionId: lead.id });
    // Review MINOR-3: vendor and Live are bound by the signature, not carried in the token.
    expect(value).not.toContain(fx.vendor.id);
    expect(value).not.toContain(fx.live.id);
    expect(verifyLiveSessionHintToken(value, { vendorId: fx.vendor.id, liveId: randomUUID() })).toBeNull();
    // The attendance cookie keeps its own narrow path.
    expect(headers.find((header) => header.startsWith(`${liveAttendanceCookieName(fx.live.id)}=`))).toMatch(/; Path=\/api\/live-admission(?:;|$)/u);
  });

  it("keeps the hint only until the registrant's session can no longer be watched (review MINOR-3)", async () => {
    const fx = await fixture();
    const lead = await registrant(fx, fx.own.id);
    const hintName = liveSessionHintCookieName(fx.live.id)!;
    const maxAgeOf = async () => {
      const header = (await openLink(fx, lead.id)).response.headers.getSetCookie().find((value) => value.startsWith(`${hintName}=`));
      return header ? Number(header.match(/Max-Age=(\d+)/u)?.[1]) : null;
    };
    const attendanceMaxAge = async () => Number((await openLink(fx, lead.id)).response.headers.getSetCookie()
      .find((value) => value.startsWith(`${liveAttendanceCookieName(fx.live.id)}=`))!.match(/Max-Age=(\d+)/u)?.[1]);
    const sessionEndsIn = (fx.own.startAt.getTime() + VIDEO_SECONDS * 1_000 - Date.now()) / 1_000;

    // Replays off: the session's end (about 20 minutes from now), while the attendance cookie keeps the link's 30 days.
    await db.live.update({ where: { id: fx.live.id }, data: { replayEnabled: false } });
    expect(Math.abs(await maxAgeOf() as number - sessionEndsIn)).toBeLessThan(5);
    expect(await attendanceMaxAge()).toBeGreaterThan(29 * 24 * 3_600);
    // A replay window of 2 hours per session: the end of that replay.
    await db.live.update({ where: { id: fx.live.id }, data: { replayEnabled: true, sessionReplayWindowHours: 2 } });
    expect(Math.abs(await maxAgeOf() as number - (sessionEndsIn + 2 * 3_600))).toBeLessThan(5);
    // Open-ended replay: the link's own expiry.
    await db.live.update({ where: { id: fx.live.id }, data: { sessionReplayWindowHours: null } });
    expect(await maxAgeOf()).toBeGreaterThan(29 * 24 * 3_600);
    // The window is already over: no hint at all, only the attendance cookie.
    await db.live.update({ where: { id: fx.live.id }, data: { replayEnabled: false } });
    await db.formSubmission.update({ where: { id: lead.id }, data: { liveSessionId: (await fx.sessionAt(fromNow(-3 * HOUR))).id } });
    expect(await maxAgeOf()).toBeNull();
    expect((await openLink(fx, lead.id)).response.headers.getSetCookie()).toHaveLength(1);
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

  it("never locks a hinted device out (review MINOR-1): own session still waiting while another plays → that session, credited to nobody", async () => {
    const fx = await fixture();
    const upcoming = await fx.sessionAt(fromNow(2 * HOUR));
    const lead = await registrant(fx, upcoming.id);
    const { cookies } = await openLink(fx, lead.id);
    const hint = hintOf(fx, cookies);
    expect(await resolve(fx, { sessionHintToken: hint })).toMatchObject({ id: fx.latest.id, source: "public" });
    // The device watches what everyone else can watch now, at the public session's offset…
    const admitted = await admit(fx, cookies);
    expect(admitted.status).toBe(200);
    const offset = await playbackOffset(fx, [...cookies, admitted.viewerCookie!]);
    expect(offset.offset).toBeLessThan(10 * 60 + 30);
    // …and since that is not the registrant's session, no watch time is credited (#647 MINOR-1).
    expect(await progressOf(fx, lead.id)).toBeNull();
  });

  it("opens nothing early: with nothing playing, a hinted device waits for its own session", async () => {
    const fx = await fixture();
    // Move both public sessions into the future: nothing plays now.
    await db.liveSession.update({ where: { id: fx.own.id }, data: { startAt: fromNow(HOUR) } });
    await db.liveSession.update({ where: { id: fx.latest.id }, data: { startAt: fromNow(3 * HOUR) } });
    const upcoming = await fx.sessionAt(fromNow(2 * HOUR));
    const lead = await registrant(fx, upcoming.id);
    const { cookies } = await openLink(fx, lead.id);
    expect(await resolve(fx, { sessionHintToken: hintOf(fx, cookies) })).toMatchObject({ id: upcoming.id, source: "session_hint" });
    expect((await admit(fx, cookies)).status).toBe(404);
    expect((await admit(fx, [])).status).toBe(404);
    expect(await progressOf(fx, lead.id)).toBeNull();
  });

  it("keeps the registration cookie strict: its own waiting or cancelled session is not swapped for the public one", async () => {
    const fx = await fixture();
    const upcoming = await fx.sessionAt(fromNow(2 * HOUR));
    const lead = await registrant(fx, upcoming.id);
    const token = createFormSubmissionChatSessionToken({ submissionId: lead.id });
    expect(await resolve(fx, { registrationToken: token })).toMatchObject({ id: upcoming.id, source: "registration" });
    expect((await admit(fx, [registrationCookie(lead.id)])).status).toBe(404);
    await db.liveSession.update({ where: { id: upcoming.id }, data: { status: "cancelled", cancelledAt: new Date() } });
    expect(await resolve(fx, { registrationToken: token })).toMatchObject({ id: upcoming.id, status: "cancelled", source: "registration" });
    expect((await admit(fx, [registrationCookie(lead.id)])).status).toBe(404);
  });

  it("follows the registration's current session after a switch, never the one it held when the link was opened", async () => {
    const fx = await fixture();
    const lead = await registrant(fx, fx.own.id);
    const { cookies } = await openLink(fx, lead.id);
    expect((await admit(fx, cookies)).status).toBe(200);
    // The registrant switches to a later session: the old (still playing) one is no longer offered;
    // with the new one still waiting the device follows the public session playing now.
    const later = await fx.sessionAt(fromNow(DAY));
    await db.formSubmission.update({ where: { id: lead.id }, data: { liveSessionId: later.id } });
    expect(await resolve(fx, { sessionHintToken: hintOf(fx, cookies) })).toMatchObject({ id: fx.latest.id, source: "public" });
    const moved = await admit(fx, cookies);
    expect(moved.status).toBe(200);
    expect((await playbackOffset(fx, [...cookies, moved.viewerCookie!])).offset).toBeLessThan(10 * 60 + 30);
    // Switching to the session playing latest makes it the hinted session.
    await db.formSubmission.update({ where: { id: lead.id }, data: { liveSessionId: fx.latest.id } });
    expect(await resolve(fx, { sessionHintToken: hintOf(fx, cookies) })).toMatchObject({ id: fx.latest.id, source: "session_hint" });
  });

  it("ignores the hint when its session is cancelled (review MINOR-1) and follows the public schedule, crediting nobody", async () => {
    const fx = await fixture();
    const lead = await registrant(fx, fx.own.id);
    const { cookies } = await openLink(fx, lead.id);
    await db.liveSession.update({ where: { id: fx.own.id }, data: { status: "cancelled", cancelledAt: new Date() } });
    expect(await resolve(fx, { sessionHintToken: hintOf(fx, cookies) })).toMatchObject({ id: fx.latest.id, source: "public" });
    const admitted = await admit(fx, cookies);
    expect(admitted.status).toBe(200);
    expect((await playbackOffset(fx, [...cookies, admitted.viewerCookie!])).offset).toBeLessThan(10 * 60 + 30);
    expect(await progressOf(fx, lead.id)).toBeNull();
  });

  it("marks only the registration cookie as \"registration\" (review MINOR-2)", async () => {
    const fx = await fixture();
    const lead = await registrant(fx, fx.own.id);
    const hint = hintValue(hintCookie(fx, lead.id));
    const registration = createFormSubmissionChatSessionToken({ submissionId: lead.id });
    // Same registration, same session: the source tells the two cookies apart.
    expect(await resolve(fx, { registrationToken: registration })).toMatchObject({ id: fx.own.id, source: "registration" });
    expect(await resolve(fx, { sessionHintToken: hint })).toMatchObject({ id: fx.own.id, source: "session_hint" });
    expect(await resolve(fx, { registrationToken: registration, sessionHintToken: hint })).toMatchObject({ id: fx.own.id, source: "registration" });
    expect(await resolve(fx, {})).toMatchObject({ id: fx.latest.id, source: "public" });
  });

  it("falls back to the public schedule for a registration that is no longer VERIFIED or was deleted (existing rules)", async () => {
    const fx = await fixture();
    const lead = await registrant(fx, fx.own.id);
    const hint = hintValue(hintCookie(fx, lead.id));
    await db.formSubmission.update({ where: { id: lead.id }, data: { verificationStatus: "UNVERIFIED" } });
    expect(await resolve(fx, { sessionHintToken: hint })).toMatchObject({ id: fx.latest.id, source: "public" });
    await db.formSubmission.delete({ where: { id: lead.id } });
    expect(await resolve(fx, { sessionHintToken: hint })).toMatchObject({ id: fx.latest.id, source: "public" });
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
    const [version, submission, expiry, signature] = genuine.split(".");
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
      ["tampered signature", `${version}.${submission}.${expiry}.${signature!.slice(0, -2)}${signature!.endsWith("AA") ? "BB" : "AA"}`],
      ["tampered registration", `${version}.${foreignForm.id}.${expiry}.${signature}`],
      ["tampered expiry", `${version}.${submission}.${Number(expiry) + 3_600}.${signature}`],
      ["attendance token", hintValue(attendanceCookie(fx, lead.id))],
    ];
    for (const [name, token] of cases) {
      expect(await resolve(fx, { sessionHintToken: token }), name).toMatchObject({ id: fx.latest.id, source: "public" });
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

  it("A3-04: replays turned off after the link was opened → an ended hinted session gives way to the session playing now", async () => {
    const fx = await fixture();
    // The registrant's session started 2 hours ago and ended an hour ago; `latest` is playing.
    const ended = await fx.sessionAt(fromNow(-2 * HOUR));
    const lead = await registrant(fx, ended.id);
    // Replays on (the default) when the link is opened: the hint is issued and shows the replay.
    const { cookies } = await openLink(fx, lead.id);
    const hint = hintOf(fx, cookies);
    expect(await resolve(fx, { sessionHintToken: hint })).toMatchObject({ id: ended.id, source: "session_hint" });
    // The vendor then turns replays off: the hint no longer blocks the public session.
    await db.live.update({ where: { id: fx.live.id }, data: { replayEnabled: false } });
    expect(await resolve(fx, { sessionHintToken: hint })).toMatchObject({ id: fx.latest.id, source: "public" });
    const admitted = await admit(fx, cookies);
    expect(admitted.status).toBe(200);
    const offset = await playbackOffset(fx, [...cookies, admitted.viewerCookie!]);
    expect(offset.status).toBe(200);
    expect(offset.offset).toBeLessThan(10 * 60 + 30);
    // Not the registrant's session: no watch time is credited (#647 MINOR-1).
    expect(await progressOf(fx, lead.id)).toBeNull();
    // Turned back on: the replay of the registrant's own session again.
    await db.live.update({ where: { id: fx.live.id }, data: { replayEnabled: true } });
    expect(await resolve(fx, { sessionHintToken: hint })).toMatchObject({ id: ended.id, source: "session_hint" });
  });

  it("A3-04: a closed replay window or a passed replay deadline drops the hint, re-read on every request", async () => {
    const fx = await fixture();
    // Ended 90 minutes ago; a 2-hour window keeps its replay open for 30 more minutes.
    const ended = await fx.sessionAt(fromNow(-150 * MINUTE));
    const lead = await registrant(fx, ended.id);
    await db.live.update({ where: { id: fx.live.id }, data: { sessionReplayWindowHours: 2 } });
    const hint = hintValue(hintCookie(fx, lead.id));
    expect(await resolve(fx, { sessionHintToken: hint })).toMatchObject({ id: ended.id, source: "session_hint" });
    // The window shortened to 1 hour: closed 30 minutes ago.
    await db.live.update({ where: { id: fx.live.id }, data: { sessionReplayWindowHours: 1 } });
    expect(await resolve(fx, { sessionHintToken: hint })).toMatchObject({ id: fx.latest.id, source: "public" });
    // An open-ended window but a Live-wide replay deadline already passed.
    await db.live.update({ where: { id: fx.live.id }, data: { sessionReplayWindowHours: null, replayAvailableUntil: fromNow(-MINUTE) } });
    expect(await resolve(fx, { sessionHintToken: hint })).toMatchObject({ id: fx.latest.id, source: "public" });
    // A playing hinted session is never affected by the replay rules.
    await db.live.update({ where: { id: fx.live.id }, data: { replayEnabled: false } });
    await db.formSubmission.update({ where: { id: lead.id }, data: { liveSessionId: fx.own.id } });
    expect(await resolve(fx, { sessionHintToken: hint })).toMatchObject({ id: fx.own.id, source: "session_hint" });
  });

  it("A3-04: moved to a session that is already over with no replay → the public schedule, never the old or the ended session", async () => {
    const fx = await fixture();
    const lead = await registrant(fx, fx.own.id);
    const { cookies } = await openLink(fx, lead.id);
    const hint = hintOf(fx, cookies);
    expect(await resolve(fx, { sessionHintToken: hint })).toMatchObject({ id: fx.own.id, source: "session_hint" });
    // The vendor moves the registration to a session that ended two hours ago, with replays off.
    const past = await fx.sessionAt(fromNow(-3 * HOUR));
    await db.formSubmission.update({ where: { id: lead.id }, data: { liveSessionId: past.id } });
    await db.live.update({ where: { id: fx.live.id }, data: { replayEnabled: false } });
    expect(await resolve(fx, { sessionHintToken: hint })).toMatchObject({ id: fx.latest.id, source: "public" });
    const admitted = await admit(fx, cookies);
    expect(admitted.status).toBe(200);
    expect((await playbackOffset(fx, [...cookies, admitted.viewerCookie!])).offset).toBeLessThan(10 * 60 + 30);
    expect(await progressOf(fx, lead.id)).toBeNull();
    // With replays on, the registration's current session (its replay) is followed, still not the old one.
    await db.live.update({ where: { id: fx.live.id }, data: { replayEnabled: true } });
    expect(await resolve(fx, { sessionHintToken: hint })).toMatchObject({ id: past.id, source: "session_hint" });
  });

  it("A3-04: moved away while the old session is the only one playing → that session publicly, credited to nobody", async () => {
    const fx = await fixture();
    // Only the registrant's original session plays now.
    await db.liveSession.update({ where: { id: fx.latest.id }, data: { startAt: fromNow(3 * HOUR) } });
    const lead = await registrant(fx, fx.own.id);
    const { cookies } = await openLink(fx, lead.id);
    const hint = hintOf(fx, cookies);
    const upcoming = await fx.sessionAt(fromNow(DAY));
    await db.formSubmission.update({ where: { id: lead.id }, data: { liveSessionId: upcoming.id } });
    // The old session is what everyone can watch now, but it is no longer the hint's session.
    expect(await resolve(fx, { sessionHintToken: hint })).toMatchObject({ id: fx.own.id, source: "public" });
    const admitted = await admit(fx, cookies);
    expect(admitted.status).toBe(200);
    expect(await progressOf(fx, lead.id)).toBeNull();
    // Once nothing plays, the device waits for the registration's new session.
    await db.liveSession.update({ where: { id: fx.own.id }, data: { startAt: fromNow(2 * HOUR) } });
    expect(await resolve(fx, { sessionHintToken: hint })).toMatchObject({ id: upcoming.id, source: "session_hint" });
  });

  it("A3-04: an ended hinted session without replay and nothing playing → the next public session", async () => {
    const fx = await fixture();
    await db.liveSession.update({ where: { id: fx.own.id }, data: { startAt: fromNow(-3 * HOUR) } });
    await db.liveSession.update({ where: { id: fx.latest.id }, data: { startAt: fromNow(2 * HOUR) } });
    await db.live.update({ where: { id: fx.live.id }, data: { replayEnabled: false } });
    const lead = await registrant(fx, fx.own.id);
    const hint = hintValue(hintCookie(fx, lead.id));
    expect(await resolve(fx, { sessionHintToken: hint })).toMatchObject({ id: fx.latest.id, source: "public" });
    expect((await admit(fx, [`${liveSessionHintCookieName(fx.live.id)}=${hint}`])).status).toBe(404);
    // The registration cookie stays strict: its own ended session, not swapped for the public one.
    const registration = createFormSubmissionChatSessionToken({ submissionId: lead.id });
    expect(await resolve(fx, { registrationToken: registration, sessionHintToken: hint })).toMatchObject({ id: fx.own.id, source: "registration" });
  });

  it("lets a valid registration cookie win over the hint, as before", async () => {
    const fx = await fixture();
    const owner = await registrant(fx, fx.latest.id);
    const forwarded = await registrant(fx, fx.own.id);
    const cookies = [registrationCookie(owner.id), attendanceCookie(fx, forwarded.id), hintCookie(fx, forwarded.id)];
    expect(await resolve(fx, { registrationToken: createFormSubmissionChatSessionToken({ submissionId: owner.id }), sessionHintToken: hintValue(cookies[2]!) }))
      .toMatchObject({ id: fx.latest.id, source: "registration" });
    const admitted = await admit(fx, cookies);
    expect(admitted.status).toBe(200);
    // The registration cookie's registration is credited; the forwarded one is not.
    expect(await progressOf(fx, owner.id)).toMatchObject({ watchedSeconds: 0 });
    expect(await progressOf(fx, forwarded.id)).toBeNull();
    // A registration cookie of another Live does not hide the hint.
    const sibling = await fixture();
    const siblingLead = await registrant(sibling, sibling.own.id);
    expect(await resolve(fx, { registrationToken: createFormSubmissionChatSessionToken({ submissionId: siblingLead.id }), sessionHintToken: hintValue(cookies[2]!) }))
      .toMatchObject({ id: fx.own.id, source: "session_hint" });
  });
});
