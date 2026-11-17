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
import {
  createFormSubmissionChatSessionToken,
  FORM_SUBMISSION_CHAT_SESSION_COOKIE,
  verifyFormSubmissionChatSessionToken,
} from "@/lib/form-submission-chat-session";
import { formNoShowEventId, formNoShowSessionKey, runFormNoShowAutomation } from "@/lib/form-no-show-automation";
import { createLiveSessionSwitchToken } from "@/lib/live-session-switch-token";
import { recordAttendanceForAdmission } from "@/lib/live-registration-attendance";
import { createLiveWatchLinkToken, createLiveWatchLinkUrl } from "@/lib/live-watch-link-token";
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
      ...(options.cookie ? { cookie: `${FORM_SUBMISSION_CHAT_SESSION_COOKIE}=${options.cookie}` } : {}),
    },
  }));
}

/** The registration cookie the response sets, or null. */
function registrationCookie(response: Response) {
  const header = response.headers.get("set-cookie") ?? "";
  const match = header.match(new RegExp(`${FORM_SUBMISSION_CHAT_SESSION_COOKIE}=([^;]+)`, "u"));
  return match ? decodeURIComponent(match[1]!) : null;
}

function linkFor(t: Tenant, liveId: string, submissionId: string, sessionStartAt = ago(3 * HOUR)) {
  return createLiveWatchLinkToken({ vendorId: t.vendor.id, liveId, submissionId, sessionStartAt });
}

describe("GET /api/live-watch-link (Q-17)", () => {
  it("sets the registration cookie of a valid link and redirects to the clean viewer page", async () => {
    const t = await tenant();
    const session = await live(t);
    const lead = await registrant(t, session.id);
    const url = createLiveWatchLinkUrl({ vendorId: t.vendor.id, liveId: session.id, submissionId: lead.id, sessionStartAt: session.scheduledAt });

    const response = await GET(new Request(url));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${APP_URL}/live/${session.slug}`);
    expect(response.headers.get("location")).not.toContain("token");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const cookie = registrationCookie(response);
    expect(verifyFormSubmissionChatSessionToken(cookie ?? "")?.submissionId).toBe(lead.id);
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/HttpOnly/iu);
    expect(setCookie).toMatch(/SameSite=lax/iu);
    expect(setCookie).toMatch(/Secure/iu);
    // Reusable: a second device opening the same link is admitted too.
    expect(registrationCookie(await GET(new Request(url)))).not.toBeNull();
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
    const cookie = registrationCookie(prefetch);
    expect(cookie).not.toBeNull();
    await expect(db.liveRegistrationAttendance.count({ where: { vendorId: t.vendor.id } })).resolves.toBe(0);

    // What /api/live-admission does after granting playback to that browser
    // (here: the replay, before the no-show job runs).
    const admission = new Request(`${APP_URL}/api/live-admission`, { method: "POST", headers: { cookie: `${FORM_SUBMISSION_CHAT_SESSION_COOKIE}=${cookie}` } });
    await expect(recordAttendanceForAdmission({ request: admission, vendorId: t.vendor.id, liveId: session.id })).resolves.toBe("recorded");

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
    expect(registrationCookie(expiredResponse)).toBeNull();

    const valid = linkFor(t, session.id, lead.id);
    const [version, payload, signature] = valid.split(".");
    const altered = `${version}.${payload}.${signature!.slice(0, -2)}${signature!.endsWith("AA") ? "BB" : "AA"}`;
    const foreign = [
      altered,
      createFormSubmissionChatSessionToken({ submissionId: lead.id }),
      createLiveSessionSwitchToken({ vendorId: t.vendor.id, submissionId: lead.id, sessionId: "session_x" }),
      "not-a-token",
      "x".repeat(700),
    ];
    for (const token of [...foreign, null]) {
      const response = await open(token);
      expect(response.status, String(token).slice(0, 20)).toBe(303);
      expect(response.headers.get("location")).toBe(`${APP_URL}/`);
      expect(registrationCookie(response)).toBeNull();
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
      expect(registrationCookie(response), name).toBeNull();
    }

    await db.vendor.update({ where: { id: t.vendor.id }, data: { suspendedAt: new Date(), suspendedReason: "合成" } });
    const suspended = await open(linkFor(t, session.id, lead.id));
    expect(registrationCookie(suspended)).toBeNull();
    // Lifting the suspension makes the same link work again.
    await db.vendor.update({ where: { id: t.vendor.id }, data: { suspendedAt: null, suspendedReason: null } });
    expect(registrationCookie(await open(linkFor(t, session.id, lead.id)))).not.toBeNull();
    await expect(db.liveRegistrationAttendance.count({ where: { vendorId: { in: [t.vendor.id, other.vendor.id] } } })).resolves.toBe(0);
  });

  it("keeps a browser's own registration of the same Live, and replaces any other cookie", async () => {
    const t = await tenant();
    const session = await live(t);
    const sibling = await live(t);
    const owner = await registrant(t, session.id);
    const forwarded = await registrant(t, session.id);
    const otherLiveLead = await registrant(t, sibling.id);
    const link = linkFor(t, session.id, forwarded.id);

    // The browser already belongs to another verified registrant of this Live.
    const kept = await open(link, { cookie: createFormSubmissionChatSessionToken({ submissionId: owner.id }) });
    expect(kept.headers.get("location")).toBe(`${APP_URL}/live/${session.slug}`);
    expect(registrationCookie(kept)).toBeNull();

    // A cookie of another Live's registration (or of the same registration) is replaced.
    for (const existing of [otherLiveLead.id, forwarded.id]) {
      const replaced = await open(link, { cookie: createFormSubmissionChatSessionToken({ submissionId: existing }) });
      expect(verifyFormSubmissionChatSessionToken(registrationCookie(replaced) ?? "")?.submissionId).toBe(forwarded.id);
    }
  });
});
