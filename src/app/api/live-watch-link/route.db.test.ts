import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Q-17 personal watch link on the disposable PostgreSQL database:
// registrations, Lives, attendance and the no-show automation are real.
// Synthetic: monitoring and the post-response e-mail send. No provider,
// e-mail or LINE service is called.
const monitoring = vi.hoisted(() => ({ captureOperationalError: vi.fn() }));
vi.mock("@/lib/monitoring", async (original) => ({
  ...await original<typeof import("@/lib/monitoring")>(),
  captureOperationalError: monitoring.captureOperationalError,
}));
vi.mock("@/lib/email-delivery-immediate", async (original) => ({
  ...await original<typeof import("@/lib/email-delivery-immediate")>(),
  scheduleImmediateEmailDispatch: vi.fn(),
}));

import { GET } from "@/app/api/live-watch-link/route";
import { getDb } from "@/lib/db";
import { createFormSubmissionChatSessionToken, FORM_SUBMISSION_CHAT_SESSION_COOKIE } from "@/lib/form-submission-chat-session";
import { formNoShowEventId, formNoShowSessionKey, runFormNoShowAutomation } from "@/lib/form-no-show-automation";
import { createLiveAttendanceToken, liveAttendanceCookieName, verifyLiveAttendanceToken } from "@/lib/live-attendance-cookie";
import { createLiveSessionSwitchToken } from "@/lib/live-session-switch-token";
import { LIVE_REGISTRATION_ATTENDANCE_REFRESH_MS, recordAttendanceForAdmission } from "@/lib/live-registration-attendance";
import { createLiveWatchLinkToken, createLiveWatchLinkUrl, verifyLiveWatchLinkToken } from "@/lib/live-watch-link-token";
import { resetInMemoryRateLimitForTests } from "@/lib/rate-limit";

vi.setConfig({ testTimeout: 30_000 });

const db = getDb();
const vendorIds: string[] = [];
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const APP_URL = "https://watch-link.example.test";
const ago = (ms: number) => new Date(Date.now() - ms);

beforeEach(() => {
  vi.stubEnv("CSRF_SECRET", "live-watch-link-disposable-secret-longer-than-thirty-two-bytes");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", APP_URL);
  resetInMemoryRateLimitForTests();
  monitoring.captureOperationalError.mockClear();
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await db.vendor.deleteMany({ where: { id: { in: vendorIds.splice(0) } } });
});

type Tenant = Awaited<ReturnType<typeof tenant>>;

async function tenant() {
  const key = randomUUID().slice(0, 12);
  const vendor = await db.vendor.create({
    data: {
      name: `觀看連結商家 ${key}`,
      slug: `watch-link-${key}`,
      email: `vendor-${key}@example.test`,
      passwordHash: "synthetic-only",
      betaFeatureGrants: ["automation_form_no_show"],
    },
  });
  vendorIds.push(vendor.id);
  const form = await db.registrationForm.create({
    data: { vendorId: vendor.id, name: "報名表", slug: `watch-link-form-${key}`, headline: "報名", fields: [{ key: "email", label: "Email", type: "email", required: true }] },
  });
  const video = await db.video.create({
    data: { vendorId: vendor.id, title: "預錄影片", videoUrl: "https://media.example.test/watch-link.mp4", durationSec: 600, status: "ready", sourceType: "url" },
  });
  return { vendor, form, video };
}

function live(t: Tenant, data: Partial<Prisma.LiveUncheckedCreateInput> = {}) {
  return db.live.create({
    data: {
      vendorId: t.vendor.id,
      formId: t.form.id,
      videoId: t.video.id,
      title: "觀看連結直播",
      slug: `watch-link-live-${randomUUID().slice(0, 12)}`,
      scheduledAt: ago(3 * HOUR),
      status: "scheduled",
      streamMode: "vod",
      ...data,
    },
  });
}

function registrant(t: Tenant, liveId: string, options: { verified?: boolean } = {}) {
  const verified = options.verified ?? true;
  return db.formSubmission.create({
    data: {
      formId: t.form.id,
      liveId,
      name: "王小明",
      email: `lead-${randomUUID().slice(0, 8)}@example.test`,
      verificationStatus: verified ? "VERIFIED" : "UNVERIFIED",
      verifiedAt: verified ? ago(5 * HOUR) : null,
      createdAt: ago(6 * HOUR),
    },
  });
}

function open(token: string | null, options: { cookie?: string } = {}) {
  const url = new URL("/api/live-watch-link", APP_URL);
  if (token !== null) url.searchParams.set("token", token);
  return GET(new Request(url, {
    headers: {
      "x-forwarded-for": `203.0.113.${Math.floor(Math.random() * 200) + 1}`,
      ...(options.cookie ? { cookie: options.cookie } : {}),
    },
  }));
}

/** The attendance cookie of this Live the response sets (value and raw Set-Cookie), or null. */
function attendanceCookie(response: Response, liveId: string) {
  const name = liveAttendanceCookieName(liveId)!;
  const header = response.headers.getSetCookie().find((value) => value.startsWith(`${name}=`));
  if (!header) return null;
  return { value: decodeURIComponent(header.slice(name.length + 1).split(";")[0]!), header };
}

function setsRegistrationCookie(response: Response) {
  return response.headers.getSetCookie().some((value) => value.startsWith(`${FORM_SUBMISSION_CHAT_SESSION_COOKIE}=`));
}

function linkFor(t: Tenant, liveId: string, submissionId: string, sessionStartAt = ago(3 * HOUR)) {
  return createLiveWatchLinkToken({ vendorId: t.vendor.id, liveId, submissionId, sessionStartAt });
}

/** What /api/live-admission does after granting playback to a browser carrying these cookies. */
function admit(t: Tenant, liveId: string, cookies: string[], now?: Date) {
  const request = new Request(`${APP_URL}/api/live-admission`, { method: "POST", headers: { cookie: cookies.join("; ") } });
  return recordAttendanceForAdmission({ request, vendorId: t.vendor.id, liveId, ...(now ? { now } : {}) });
}

function attendanceOf(t: Tenant) {
  return db.liveRegistrationAttendance.findMany({ where: { vendorId: t.vendor.id }, select: { formSubmissionId: true } });
}

describe("GET /api/live-watch-link (Q-17)", () => {
  it("sets only the attendance cookie of that Live and redirects to the clean viewer page", async () => {
    const t = await tenant();
    const session = await live(t);
    const lead = await registrant(t, session.id);
    const url = createLiveWatchLinkUrl({ vendorId: t.vendor.id, liveId: session.id, submissionId: lead.id, sessionStartAt: session.scheduledAt });
    const linkExpiry = verifyLiveWatchLinkToken(new URL(url).searchParams.get("token"))!.claim.expiresAt;

    const response = await GET(new Request(url));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${APP_URL}/live/${session.slug}`);
    expect(response.headers.get("location")).not.toContain("token");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    // Never the full registration cookie (no chat, private chat, LINE or checkout identity).
    expect(setsRegistrationCookie(response)).toBe(false);
    expect(response.headers.getSetCookie()).toHaveLength(1);
    const cookie = attendanceCookie(response, session.id)!;
    expect(verifyLiveAttendanceToken(cookie.value)).toEqual({ vendorId: t.vendor.id, liveId: session.id, submissionId: lead.id, expiresAt: linkExpiry });
    expect(cookie.header).toMatch(/; Path=\/api\/live-admission(?:;|$)/u);
    expect(cookie.header).toMatch(/HttpOnly/iu);
    expect(cookie.header).toMatch(/SameSite=lax/iu);
    expect(cookie.header).toMatch(/Secure/iu);
    const maxAge = Number(cookie.header.match(/Max-Age=(\d+)/u)?.[1]);
    expect(Math.abs(maxAge - (linkExpiry.getTime() - Date.now()) / 1_000)).toBeLessThan(60);
    // Reusable: a second device opening the same link gets the cookie too.
    expect(attendanceCookie(await GET(new Request(url)), session.id)).not.toBeNull();
  });

  it("records no attendance when the link is only fetched (mail scanner, preview); the admission that follows does, and the registrant is no longer a no-show", async () => {
    const t = await tenant();
    await db.automationRule.create({
      data: {
        vendorId: t.vendor.id,
        name: "缺席喚醒",
        trigger: "form_no_show",
        condition: { type: "always" } as Prisma.InputJsonValue,
        actions: [{ type: "add_customer_tag", tag: "缺席" }] as Prisma.InputJsonArray,
        isActive: true,
        updatedAt: ago(7 * HOUR),
      },
    });
    const session = await live(t);
    const watcher = await registrant(t, session.id);
    const absent = await registrant(t, session.id);

    const prefetch = await open(linkFor(t, session.id, watcher.id, session.scheduledAt));
    const cookie = attendanceCookie(prefetch, session.id);
    expect(cookie).not.toBeNull();
    await expect(db.liveRegistrationAttendance.count({ where: { vendorId: t.vendor.id } })).resolves.toBe(0);

    // The replay, watched with only the attendance cookie, before the no-show job runs.
    await expect(admit(t, session.id, [`${liveAttendanceCookieName(session.id)}=${cookie!.value}`])).resolves.toBe("recorded");
    await expect(attendanceOf(t)).resolves.toEqual([{ formSubmissionId: watcher.id }]);

    await expect(runFormNoShowAutomation({ vendorIds: [t.vendor.id] })).resolves.toMatchObject({ candidates: 1, completed: 1 });
    const logs = await db.automationExecutionLog.findMany({ where: { vendorId: t.vendor.id, trigger: "form_no_show" }, select: { eventId: true } });
    expect(logs).toEqual([{ eventId: formNoShowEventId(absent.id, formNoShowSessionKey.single(session.scheduledAt)) }]);
  });

  it("sets nothing for an expired, altered, foreign-purpose or missing token and never says why", async () => {
    const t = await tenant();
    const session = await live(t);
    const lead = await registrant(t, session.id);

    // Expired: still redirects to that Live's page.
    const expired = createLiveWatchLinkToken(
      { vendorId: t.vendor.id, liveId: session.id, submissionId: lead.id, sessionStartAt: ago(40 * DAY) },
      ago(40 * DAY),
    );
    const expiredResponse = await open(expired);
    expect(expiredResponse.headers.get("location")).toBe(`${APP_URL}/live/${session.slug}`);
    expect(expiredResponse.headers.getSetCookie()).toEqual([]);

    const valid = linkFor(t, session.id, lead.id);
    const [version, payload, signature] = valid.split(".");
    const altered = `${version}.${payload}.${signature!.slice(0, -2)}${signature!.endsWith("AA") ? "BB" : "AA"}`;
    const foreign = [
      altered,
      createFormSubmissionChatSessionToken({ submissionId: lead.id }),
      createLiveAttendanceToken({ vendorId: t.vendor.id, liveId: session.id, submissionId: lead.id, expiresAt: new Date(Date.now() + DAY) }),
      createLiveSessionSwitchToken({ vendorId: t.vendor.id, submissionId: lead.id, sessionId: "session_x" }),
      "not-a-token",
      "x".repeat(700),
    ];
    for (const token of [...foreign, null]) {
      const response = await open(token);
      expect(response.status, String(token).slice(0, 20)).toBe(303);
      expect(response.headers.get("location")).toBe(`${APP_URL}/`);
      expect(response.headers.getSetCookie()).toEqual([]);
    }
  });

  it("sets nothing across Lives or vendors, for an unverified registration or a suspended vendor", async () => {
    const t = await tenant();
    const other = await tenant();
    const session = await live(t);
    const sibling = await live(t);
    const lead = await registrant(t, session.id);
    const siblingLead = await registrant(t, sibling.id);
    const unverified = await registrant(t, session.id, { verified: false });
    const foreignLive = await live(other);
    const foreignLead = await registrant(other, foreignLive.id);

    const cases: Array<[string, string, string]> = [
      // Another Live's registration under this Live's id.
      ["cross-live", createLiveWatchLinkToken({ vendorId: t.vendor.id, liveId: session.id, submissionId: siblingLead.id, sessionStartAt: session.scheduledAt }), `/live/${session.slug}`],
      // Another vendor's id with this vendor's Live and registration.
      ["cross-vendor", createLiveWatchLinkToken({ vendorId: other.vendor.id, liveId: session.id, submissionId: lead.id, sessionStartAt: session.scheduledAt }), "/"],
      // This vendor's id with another vendor's Live and registration.
      ["foreign-live", createLiveWatchLinkToken({ vendorId: t.vendor.id, liveId: foreignLive.id, submissionId: foreignLead.id, sessionStartAt: session.scheduledAt }), "/"],
      ["unverified", linkFor(t, session.id, unverified.id), `/live/${session.slug}`],
    ];
    for (const [name, token, location] of cases) {
      const response = await open(token);
      expect(response.headers.get("location"), name).toBe(`${APP_URL}${location}`);
      expect(response.headers.getSetCookie(), name).toEqual([]);
    }

    await db.vendor.update({ where: { id: t.vendor.id }, data: { suspendedAt: new Date(), suspendedReason: "合成" } });
    expect((await open(linkFor(t, session.id, lead.id))).headers.getSetCookie()).toEqual([]);
    // Lifting the suspension makes the same link work again.
    await db.vendor.update({ where: { id: t.vendor.id }, data: { suspendedAt: null, suspendedReason: null } });
    expect(attendanceCookie(await open(linkFor(t, session.id, lead.id)), session.id)).not.toBeNull();
    await expect(db.liveRegistrationAttendance.count({ where: { vendorId: { in: [t.vendor.id, other.vendor.id] } } })).resolves.toBe(0);
  });

  it("answers 429 past 60 links a minute from one address, uncached and without any cookie (review n-3)", async () => {
    // The application-layer limiter runs under the memory and Upstash
    // providers. Under cloudflare_waf (CI's setting) checkRateLimit defers to
    // the WAF in front of the app by design; the next test covers that.
    vi.stubEnv("RATE_LIMIT_PROVIDER", "memory");
    const t = await tenant();
    const session = await live(t);
    const lead = await registrant(t, session.id);
    const fromOneAddress = (token: string) => GET(new Request(new URL(`/api/live-watch-link?token=${encodeURIComponent(token)}`, APP_URL), {
      headers: { "x-forwarded-for": "198.51.100.77" },
    }));
    for (let index = 0; index < 60; index += 1) {
      expect((await fromOneAddress("not-a-token")).status).toBe(303);
    }
    const limited = await fromOneAddress(linkFor(t, session.id, lead.id));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("cache-control")).toBe("private, no-store");
    expect(limited.headers.get("referrer-policy")).toBe("no-referrer");
    expect(limited.headers.getSetCookie()).toEqual([]);
    // Another address is unaffected.
    expect(attendanceCookie(await open(linkFor(t, session.id, lead.id)), session.id)).not.toBeNull();
  });

  it("leaves per-address limiting to the WAF under cloudflare_waf, like every checkRateLimit route", async () => {
    vi.stubEnv("RATE_LIMIT_PROVIDER", "cloudflare_waf");
    const t = await tenant();
    const session = await live(t);
    const lead = await registrant(t, session.id);
    const fromOneAddress = (token: string) => GET(new Request(new URL(`/api/live-watch-link?token=${encodeURIComponent(token)}`, APP_URL), {
      headers: { "x-forwarded-for": "198.51.100.78" },
    }));
    for (let index = 0; index < 60; index += 1) {
      expect((await fromOneAddress("not-a-token")).status).toBe(303);
    }
    // The 61st is not refused here: Cloudflare counts per source IP before the request reaches Next.js.
    const deferred = await fromOneAddress(linkFor(t, session.id, lead.id));
    expect(deferred.status).toBe(303);
    expect(attendanceCookie(deferred, session.id)).not.toBeNull();
  });

  it("neither reads nor replaces the browser's registration cookie", async () => {
    const t = await tenant();
    const session = await live(t);
    const owner = await registrant(t, session.id);
    const forwarded = await registrant(t, session.id);
    const response = await open(linkFor(t, session.id, forwarded.id), {
      cookie: `${FORM_SUBMISSION_CHAT_SESSION_COOKIE}=${createFormSubmissionChatSessionToken({ submissionId: owner.id })}`,
    });
    expect(setsRegistrationCookie(response)).toBe(false);
    expect(verifyLiveAttendanceToken(attendanceCookie(response, session.id)!.value)?.submissionId).toBe(forwarded.id);
  });
});

describe("attendance from /api/live-admission with both cookies (Q-17)", () => {
  it("prefers the registration cookie of this Live and falls back to the attendance cookie otherwise", async () => {
    const t = await tenant();
    const session = await live(t);
    const sibling = await live(t);
    const owner = await registrant(t, session.id);
    const forwarded = await registrant(t, session.id);
    const siblingLead = await registrant(t, sibling.id);
    const unverified = await registrant(t, session.id, { verified: false });
    const attendanceName = liveAttendanceCookieName(session.id)!;
    const registrationOf = (id: string) => `${FORM_SUBMISSION_CHAT_SESSION_COOKIE}=${createFormSubmissionChatSessionToken({ submissionId: id })}`;
    const attendanceOfLead = (id: string, overrides: { vendorId?: string; liveId?: string } = {}) => `${attendanceName}=${createLiveAttendanceToken({
      vendorId: overrides.vendorId ?? t.vendor.id, liveId: overrides.liveId ?? session.id, submissionId: id, expiresAt: new Date(Date.now() + DAY),
    })}`;

    // Both name a registration of this Live: only the registration cookie's is recorded.
    await expect(admit(t, session.id, [registrationOf(owner.id), attendanceOfLead(forwarded.id)])).resolves.toBe("recorded");
    await expect(attendanceOf(t)).resolves.toEqual([{ formSubmissionId: owner.id }]);
    // Inside the refresh interval the fresh registration still wins; nothing goes to the attendance cookie.
    await expect(admit(t, session.id, [registrationOf(owner.id), attendanceOfLead(forwarded.id)])).resolves.toBe("unchanged");
    await expect(attendanceOf(t)).resolves.toEqual([{ formSubmissionId: owner.id }]);

    // The registration cookie belongs to another Live: the attendance cookie decides.
    await expect(admit(t, session.id, [registrationOf(siblingLead.id), attendanceOfLead(forwarded.id)])).resolves.toBe("recorded");
    expect((await attendanceOf(t)).map((row) => row.formSubmissionId).sort()).toEqual([owner.id, forwarded.id].sort());

    // An attendance cookie is bound to its Live, vendor and a VERIFIED registration.
    await db.liveRegistrationAttendance.deleteMany({ where: { vendorId: t.vendor.id } });
    for (const cookie of [
      attendanceOfLead(siblingLead.id),
      attendanceOfLead(owner.id, { liveId: sibling.id }),
      attendanceOfLead(owner.id, { vendorId: "another-vendor" }),
      attendanceOfLead(unverified.id),
    ]) {
      await admit(t, session.id, [cookie]);
    }
    await expect(attendanceOf(t)).resolves.toEqual([]);
  });

  it("falls back to the attendance cookie when the registration cookie names this Live but is unverified or another vendor's (review n-3)", async () => {
    const t = await tenant();
    const other = await tenant();
    const session = await live(t);
    const forwarded = await registrant(t, session.id);
    const unverified = await registrant(t, session.id, { verified: false });
    // A registration row of this Live whose form belongs to another vendor.
    const foreignForm = await db.formSubmission.create({
      data: { formId: other.form.id, liveId: session.id, name: "他店", email: `foreign-${randomUUID().slice(0, 8)}@example.test`, verificationStatus: "VERIFIED", verifiedAt: ago(5 * HOUR), createdAt: ago(6 * HOUR) },
    });
    const attendance = `${liveAttendanceCookieName(session.id)}=${createLiveAttendanceToken({ vendorId: t.vendor.id, liveId: session.id, submissionId: forwarded.id, expiresAt: new Date(Date.now() + DAY) })}`;
    for (const registration of [unverified.id, foreignForm.id]) {
      await db.liveRegistrationAttendance.deleteMany({ where: { vendorId: { in: [t.vendor.id, other.vendor.id] } } });
      const cookie = `${FORM_SUBMISSION_CHAT_SESSION_COOKIE}=${createFormSubmissionChatSessionToken({ submissionId: registration })}`;
      await expect(admit(t, session.id, [cookie, attendance])).resolves.toBe("recorded");
      await expect(attendanceOf(t)).resolves.toEqual([{ formSubmissionId: forwarded.id }]);
      await expect(attendanceOf(other)).resolves.toEqual([]);
    }
  });

  it("throttles the attendance cookie's registration to one write per refresh interval (review n-3)", async () => {
    const t = await tenant();
    const session = await live(t);
    const sibling = await live(t);
    const forwarded = await registrant(t, session.id);
    const siblingLead = await registrant(t, sibling.id);
    const cookies = [
      // The registration cookie names another Live, so the attendance cookie's registration is chosen.
      `${FORM_SUBMISSION_CHAT_SESSION_COOKIE}=${createFormSubmissionChatSessionToken({ submissionId: siblingLead.id })}`,
      `${liveAttendanceCookieName(session.id)}=${createLiveAttendanceToken({ vendorId: t.vendor.id, liveId: session.id, submissionId: forwarded.id, expiresAt: new Date(Date.now() + DAY) })}`,
    ];
    const first = new Date();
    const lastAdmitted = async () => (await db.liveRegistrationAttendance.findFirstOrThrow({ where: { vendorId: t.vendor.id, formSubmissionId: forwarded.id }, select: { lastAdmittedAt: true } })).lastAdmittedAt;

    await expect(admit(t, session.id, cookies, first)).resolves.toBe("recorded");
    expect(await lastAdmitted()).toEqual(first);
    // 30-second renewals inside the interval only read.
    await expect(admit(t, session.id, cookies, new Date(first.getTime() + 30_000))).resolves.toBe("unchanged");
    await expect(admit(t, session.id, cookies, new Date(first.getTime() + LIVE_REGISTRATION_ATTENDANCE_REFRESH_MS - 1_000))).resolves.toBe("unchanged");
    expect(await lastAdmitted()).toEqual(first);
    const later = new Date(first.getTime() + LIVE_REGISTRATION_ATTENDANCE_REFRESH_MS + 1_000);
    await expect(admit(t, session.id, cookies, later)).resolves.toBe("recorded");
    expect(await lastAdmitted()).toEqual(later);
    await expect(db.liveRegistrationAttendance.count({ where: { vendorId: t.vendor.id } })).resolves.toBe(1);
  });
});
