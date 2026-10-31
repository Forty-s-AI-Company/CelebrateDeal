import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  sessionFindFirst: vi.fn(),
  transaction: vi.fn(),
  switchSeat: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getDb: () => ({ formSubmission: { findFirst: mocks.findFirst }, liveSession: { findFirst: mocks.sessionFindFirst }, $transaction: mocks.transaction }) }));
vi.mock("@/lib/live-fixed-sessions-store", async (original) => ({
  ...await original<typeof import("@/lib/live-fixed-sessions-store")>(),
  lockFixedSessionLive: vi.fn(async () => true),
  switchFixedSessionSeat: mocks.switchSeat,
}));
vi.mock("@/lib/email-delivery", () => ({ ensureLiveReminderDelivery: vi.fn() }));
vi.mock("@/lib/live-notification-delivery", () => ({ materializeLiveNotificationsForSubmission: vi.fn(), supersedeRegistrantFixedTimeDeliveries: vi.fn() }));

import { createFormSubmissionChatSessionToken, FORM_SUBMISSION_CHAT_SESSION_COOKIE } from "@/lib/form-submission-chat-session";
import { resolveRepeatedFixedSessionRegistration } from "@/lib/live-fixed-session-registration";
import { FixedSessionSwitchConflict } from "@/lib/live-fixed-sessions-store";

const NOW = new Date("2030-10-30T05:00:00.000Z");
const held = { vendorId: "vendor-1", liveId: "live-1", startAt: new Date("2030-10-30T04:50:00.000Z"), status: "open" };

const target = { id: "session-new", startAt: new Date("2030-11-02T04:00:00.000Z"), capacity: 2, registeredCount: 1, status: "open" };

function request(cookie?: string) {
  return new Request("https://app.example.test/api/form-submissions", { method: "POST", headers: cookie ? { cookie } : {} });
}
const input = (cookie?: string) => ({
  request: request(cookie), vendorId: "vendor-1", liveId: "live-1", submissionId: "sub-1", sessionId: "session-new",
  sessionRegistrationCutoffMinutes: 0, now: NOW,
});

describe("resolveRepeatedFixedSessionRegistration", () => {
  beforeEach(() => {
    vi.stubEnv("CSRF_SECRET", "fixed-session-registration-test-secret-longer-than-32");
    mocks.findFirst.mockReset();
    mocks.sessionFindFirst.mockReset().mockResolvedValue(target);
    mocks.transaction.mockReset().mockImplementation(async (work: (tx: unknown) => unknown) => work({}));
    mocks.switchSeat.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("conceals a registration that cannot move from anyone but its own browser", async () => {
    // The held session already started, so the registration cannot move.
    mocks.findFirst.mockResolvedValue({ liveSessionId: "session-held", liveSessionSeatReleasedAt: null, verificationStatus: "VERIFIED", liveSession: held });
    expect(await resolveRepeatedFixedSessionRegistration(input())).toEqual({ ok: true, moved: false, concealed: { sessionId: "session-held", startAt: held.startAt } });
    const other = `${FORM_SUBMISSION_CHAT_SESSION_COOKIE}=${encodeURIComponent(createFormSubmissionChatSessionToken({ submissionId: "sub-other", now: NOW }))}`;
    expect(await resolveRepeatedFixedSessionRegistration(input(other))).toMatchObject({ ok: true, concealed: { sessionId: "session-held" } });
    const own = `${FORM_SUBMISSION_CHAT_SESSION_COOKIE}=${encodeURIComponent(createFormSubmissionChatSessionToken({ submissionId: "sub-1", now: NOW }))}`;
    expect(await resolveRepeatedFixedSessionRegistration(input(own))).toEqual({ ok: false, reason: "already_registered", session: { startAt: held.startAt } });
    expect(mocks.switchSeat).not.toHaveBeenCalled();
  });

  it("fails a concealed request exactly like a fresh registration for an unavailable session", async () => {
    mocks.findFirst.mockResolvedValue({ liveSessionId: "session-held", liveSessionSeatReleasedAt: null, verificationStatus: "VERIFIED", liveSession: held });
    mocks.sessionFindFirst.mockResolvedValue({ ...target, registeredCount: 2 });
    expect(await resolveRepeatedFixedSessionRegistration(input())).toEqual({ ok: false, reason: "full" });
    mocks.sessionFindFirst.mockResolvedValue({ ...target, status: "closed" });
    expect(await resolveRepeatedFixedSessionRegistration(input())).toEqual({ ok: false, reason: "closed" });
    mocks.sessionFindFirst.mockResolvedValue(null);
    expect(await resolveRepeatedFixedSessionRegistration(input())).toEqual({ ok: false, reason: "not_found" });
    // The lookup is bound to the request's vendor and Live.
    expect(mocks.sessionFindFirst).toHaveBeenLastCalledWith(expect.objectContaining({ where: { id: "session-new", vendorId: "vendor-1", liveId: "live-1" } }));
    expect(mocks.switchSeat).not.toHaveBeenCalled();
  });

  it("answers busy, not a success, when a concurrent change wins the switch", async () => {
    mocks.findFirst.mockResolvedValue({ liveSessionId: "session-old", liveSessionSeatReleasedAt: null, verificationStatus: "UNVERIFIED", liveSession: { ...held, startAt: new Date("2030-11-01T00:00:00.000Z") } });
    mocks.switchSeat.mockRejectedValue(new FixedSessionSwitchConflict());
    expect(await resolveRepeatedFixedSessionRegistration(input())).toEqual({ ok: false, reason: "busy" });
    const { Prisma } = await import("@prisma/client");
    const deadlock = new Prisma.PrismaClientKnownRequestError("deadlock detected", { code: "P2034", clientVersion: "test", meta: { code: "40P01" } });
    mocks.switchSeat.mockReset().mockRejectedValue(deadlock);
    expect(await resolveRepeatedFixedSessionRegistration(input())).toEqual({ ok: false, reason: "busy" });
  });
});
