import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  db: { marker: "verification-db" },
  checkRateLimit: vi.fn(),
  verifyFormSubmission: vi.fn(),
  ensureRegistrationConfirmationDelivery: vi.fn(),
  ensureLiveReminderDelivery: vi.fn(),
  captureOperationalError: vi.fn(),
  startTextFailure: vi.fn((): Error | null => null),
  scheduleImmediateEmailDispatch: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getDb: () => mocks.db }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock("@/lib/form-submission-verification-domain", () => ({
  verifyFormSubmission: mocks.verifyFormSubmission,
}));
vi.mock("@/lib/email-delivery", () => ({
  ensureRegistrationConfirmationDelivery: mocks.ensureRegistrationConfirmationDelivery,
  ensureLiveReminderDelivery: mocks.ensureLiveReminderDelivery,
}));
vi.mock("@/lib/monitoring", () => ({ captureOperationalError: mocks.captureOperationalError }));
vi.mock("@/lib/evergreen-viewer-session", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/evergreen-viewer-session")>();
  return {
    ...original,
    evergreenRegistrationStartText: (...args: Parameters<typeof original.evergreenRegistrationStartText>) => {
      const failure = mocks.startTextFailure();
      if (failure) throw failure;
      return original.evergreenRegistrationStartText(...args);
    },
  };
});
vi.mock("@/lib/email-delivery-immediate", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/email-delivery-immediate")>(),
  scheduleImmediateEmailDispatch: mocks.scheduleImmediateEmailDispatch,
}));

import { POST } from "./route";
import { FORM_SUBMISSION_CHAT_SESSION_COOKIE } from "@/lib/form-submission-chat-session";
import { evergreenSessionCookieName, resolveEvergreenViewerSession } from "@/lib/evergreen-viewer-session";

const token = `fsv1.formsub_test.1780000000.1.${"a".repeat(43)}`;
const deliveryConfirmation = {
  vendorId: "vendor-1",
  vendorName: "測試商家",
  liveId: "live-1",
  liveTitle: "新品直播",
  formSubmissionId: "formsub_test",
  recipientName: "王小明",
  recipientEmail: "lead@example.test",
  liveScheduledAt: new Date("2026-08-10T04:00:00.000Z"),
  liveReminderOffsetMinutes: 60,
  emailBrand: {
    senderName: "測試寄件人",
    supportEmail: "support@example.test",
    contactUrl: "https://example.test/contact",
  },
  template: null,
  reminderTemplate: null,
};
const confirmation = { ...deliveryConfirmation, evergreen: null };

function request(value = token, origin: string | null = "https://app.example.test") {
  return new Request("https://app.example.test/api/form-submissions/verify", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...(origin ? { origin } : {}),
    },
    body: new URLSearchParams({ token: value }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.test");
  vi.stubEnv("CSRF_SECRET", "form-chat-session-route-test-secret-longer-than-thirty-two-bytes");
  mocks.checkRateLimit.mockResolvedValue(null);
  mocks.verifyFormSubmission.mockResolvedValue({ status: "invalid" });
  mocks.ensureRegistrationConfirmationDelivery.mockResolvedValue({ status: "not_configured" });
  mocks.ensureLiveReminderDelivery.mockResolvedValue({ status: "not_configured" });
});

afterEach(() => vi.unstubAllEnvs());

describe("POST /api/form-submissions/verify", () => {
  it("keeps the canonical loopback cookie host when NextRequest normalizes its URL", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://127.0.0.1:31028");
    vi.stubEnv("E2E_TEST_MODE", "true");
    vi.stubEnv("E2E_BASE_URL", "http://127.0.0.1:31028");
    mocks.verifyFormSubmission.mockResolvedValue({status:"already_verified",chatSession:{submissionId:"formsub_test"}});
    const normalized = new NextRequest("http://127.0.0.1:31028/api/form-submissions/verify", {
      method:"POST", headers:{origin:"http://127.0.0.1:31028",host:"127.0.0.1:31028","content-type":"application/x-www-form-urlencoded"},
      body:new URLSearchParams({token}),
    });
    expect(new URL(normalized.url).hostname).toBe("localhost");
    const response=await POST(normalized);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("http://127.0.0.1:31028/verify-registration?status=verified");
    expect(response.cookies.get(FORM_SUBMISSION_CHAT_SESSION_COOKIE)?.path).toBe("/");
  });
  it("拒絕缺少或跨網域的來源，且不執行驗證", async () => {
    for (const origin of [null, "https://attacker.example.test"]) {
      const response = await POST(request(token, origin));
      expect(response.status).toBe(403);
    }
    expect(mocks.checkRateLimit).not.toHaveBeenCalled();
    expect(mocks.verifyFormSubmission).not.toHaveBeenCalled();
  });

  it("將畸形 token 交給 domain 驗簽後導向無效頁面，且不寄送確認信", async () => {
    const response = await POST(request("not-a-verification-token"));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://app.example.test/verify-registration?status=invalid");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.verifyFormSubmission).toHaveBeenCalledWith(mocks.db, "not-a-verification-token", expect.any(Date), null);
    expect(mocks.ensureRegistrationConfirmationDelivery).not.toHaveBeenCalled();
    expect(mocks.ensureLiveReminderDelivery).not.toHaveBeenCalled();
  });

  it("serialization conflict (P2034) 會重試驗證交易，之後照常成功", async () => {
    const conflict = new Prisma.PrismaClientKnownRequestError("write conflict", { code: "P2034", clientVersion: "test" });
    mocks.verifyFormSubmission.mockRejectedValueOnce(conflict).mockResolvedValueOnce({ status: "already_verified" });

    const response = await POST(request());

    expect(mocks.verifyFormSubmission).toHaveBeenCalledTimes(2);
    expect(response.headers.get("location")).toBe("https://app.example.test/verify-registration?status=verified");
    expect(mocks.captureOperationalError).not.toHaveBeenCalled();
  });

  it("重試後仍然衝突時導向「請重試」而不是「連結無效」，並記錄監控", async () => {
    const deadlock = new Prisma.PrismaClientKnownRequestError("deadlock detected", { code: "P2010", clientVersion: "test", meta: { code: "40P01" } });
    mocks.verifyFormSubmission.mockRejectedValue(deadlock);

    const response = await POST(request());

    expect(mocks.verifyFormSubmission).toHaveBeenCalledTimes(3);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://app.example.test/verify-registration?status=retry");
    expect(mocks.captureOperationalError).toHaveBeenCalledWith(deadlock, expect.objectContaining({ source: "form_submission_verification", operation: "verify" }));
    expect(mocks.ensureRegistrationConfirmationDelivery).not.toHaveBeenCalled();
  });

  it("非暫時性的資料庫錯誤不重試，仍然 fail closed 為無效頁面", async () => {
    mocks.verifyFormSubmission.mockRejectedValue(new Error("unexpected"));

    const response = await POST(request());

    expect(mocks.verifyFormSubmission).toHaveBeenCalledTimes(1);
    expect(response.headers.get("location")).toBe("https://app.example.test/verify-registration?status=invalid");
  });

  it("將 domain 判定無效的 token 導向無效頁面", async () => {
    const response = await POST(request());

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://app.example.test/verify-registration?status=invalid");
    expect(mocks.verifyFormSubmission).toHaveBeenCalledWith(mocks.db, token, expect.any(Date), null);
    expect(mocks.ensureRegistrationConfirmationDelivery).not.toHaveBeenCalled();
    expect(mocks.ensureLiveReminderDelivery).not.toHaveBeenCalled();
  });

  it("驗證成功後才排入報名確認信", async () => {
    mocks.verifyFormSubmission.mockResolvedValue({ status: "verified", confirmation });

    const response = await POST(request());

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://app.example.test/verify-registration?status=verified");
    // A regular live keeps the scheduledAt-based {{live_start_at}} and reminder unchanged.
    expect(mocks.ensureRegistrationConfirmationDelivery).toHaveBeenCalledWith(deliveryConfirmation);
    expect(mocks.ensureLiveReminderDelivery).toHaveBeenCalledWith({
      ...deliveryConfirmation,
      template: null,
      reminderOffsetMinutes: 60,
      evergreenActive: false,
    });
    expect(mocks.captureOperationalError).not.toHaveBeenCalled();
  });

  describe("evergreen live", () => {
    const evergreenLive = {
      id: "live-1", vendorId: "vendor-1", status: "scheduled", streamMode: "vod", isEvergreen: true,
      evergreenScheduleMode: "just_in_time", evergreenIntervalMinutes: 15, evergreenDailyTimes: [], evergreenSessionStartAt: null,
      replayEnabled: false, replayAvailableUntil: null, video: { durationSec: 1_800 },
    };
    const evergreenConfirmation = { ...confirmation, evergreen: { live: evergreenLive, vendorTimezone: "Asia/Taipei" } };

    afterEach(() => vi.useRealTimers());

    it("uses the visitor's own signed session for {{live_start_at}} and schedules no fixed reminder", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-29T06:03:00.000Z"));
      const session = resolveEvergreenViewerSession({ live: evergreenLive, vendorTimezone: "Asia/Taipei", token: null, intent: "claim" })!;
      mocks.verifyFormSubmission.mockResolvedValue({ status: "verified", confirmation: evergreenConfirmation });
      const withCookie = request();
      withCookie.headers.set("cookie", `${evergreenSessionCookieName("live-1")}=${session.issuedToken}`);

      await POST(withCookie);

      const delivered = mocks.ensureRegistrationConfirmationDelivery.mock.calls[0]?.[0];
      expect(delivered).not.toHaveProperty("evergreen");
      // The 06:15 UTC cohort is 14:15 in Asia/Taipei; scheduledAt (2026-08-10) is not used.
      expect(delivered.liveStartAtText).toMatch(/下午\s?2:15$/u);
      expect(delivered.liveStartAtText).not.toContain("8月10日");
      expect(mocks.ensureLiveReminderDelivery).toHaveBeenCalledWith(expect.objectContaining({ evergreenActive: true }));
    });

    it.each([
      ["another live", { live: { ...evergreenLive, id: "live-2" } }],
      ["another vendor", { live: { ...evergreenLive, vendorId: "vendor-2" } }],
      ["a tampered signature", { tamper: true }],
    ])("ignores a session cookie issued for %s and uses the neutral phrase", async (_label, variant) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-29T06:03:00.000Z"));
      const issuedFor = "live" in variant ? variant.live : evergreenLive;
      const session = resolveEvergreenViewerSession({ live: issuedFor, vendorTimezone: "Asia/Taipei", token: null, intent: "claim" })!;
      const token = "tamper" in variant ? `${session.issuedToken!.slice(0, -2)}AA` : session.issuedToken!;
      mocks.verifyFormSubmission.mockResolvedValue({ status: "verified", confirmation: evergreenConfirmation });
      const withCookie = request();
      // Always presented under live-1's cookie name, as a moved or forged cookie would be.
      withCookie.headers.set("cookie", `${evergreenSessionCookieName("live-1")}=${token}`);

      await POST(withCookie);

      expect(mocks.ensureRegistrationConfirmationDelivery).toHaveBeenCalledWith(expect.objectContaining({ liveStartAtText: "依你的觀看時段開始" }));
    });

    it("keeps the verified result when the session time cannot be resolved", async () => {
      mocks.startTextFailure.mockReturnValueOnce(new Error("derived key unavailable for lead@example.test"));
      mocks.verifyFormSubmission.mockResolvedValue({ status: "verified", confirmation: evergreenConfirmation, chatSession: { submissionId: "formsub_test" } });

      const response = await POST(request());

      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("https://app.example.test/verify-registration?status=verified");
      expect(response.cookies.get(FORM_SUBMISSION_CHAT_SESSION_COOKIE)).toBeDefined();
      expect(mocks.ensureRegistrationConfirmationDelivery).toHaveBeenCalledWith(expect.objectContaining({ liveStartAtText: "依你的觀看時段開始" }));
      expect(mocks.ensureLiveReminderDelivery).toHaveBeenCalledWith(expect.objectContaining({ evergreenActive: true }));
      expect(mocks.captureOperationalError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ operation: "evergreen_start_text" }));
    });

    it("still sends the evergreen confirmation immediately and has no reminder to dispatch", async () => {
      mocks.verifyFormSubmission.mockResolvedValue({ status: "verified", confirmation: evergreenConfirmation });
      mocks.ensureRegistrationConfirmationDelivery.mockResolvedValue({ status: "queued", deliveryId: "email_evergreen_confirmation" });
      mocks.ensureLiveReminderDelivery.mockResolvedValue({ status: "not_scheduled" });

      await POST(request());

      expect(mocks.ensureRegistrationConfirmationDelivery).toHaveBeenCalledWith(expect.objectContaining({ liveStartAtText: "依你的觀看時段開始" }));
      expect(mocks.ensureRegistrationConfirmationDelivery.mock.calls[0]?.[0]).not.toHaveProperty("evergreen");
      expect(mocks.ensureLiveReminderDelivery).toHaveBeenCalledWith(expect.objectContaining({ evergreenActive: true }));
      expect(mocks.scheduleImmediateEmailDispatch).toHaveBeenCalledWith(["email_evergreen_confirmation"]);
    });

    it("falls back to a neutral phrase without the visitor's session cookie", async () => {
      mocks.verifyFormSubmission.mockResolvedValue({ status: "verified", confirmation: evergreenConfirmation });

      await POST(request());

      expect(mocks.ensureRegistrationConfirmationDelivery).toHaveBeenCalledWith(expect.objectContaining({ liveStartAtText: "依你的觀看時段開始" }));
      expect(mocks.ensureLiveReminderDelivery).toHaveBeenCalledWith(expect.objectContaining({ evergreenActive: true }));
    });
  });

  it("只在驗證成功後核發 chat session cookie，且不把 submission 或 token 放入 redirect response", async () => {
    const chatSession = { submissionId: confirmation.formSubmissionId };
    mocks.verifyFormSubmission.mockResolvedValue({ status: "verified", confirmation, chatSession });

    const response = await POST(request());
    const setCookie = response.headers.getSetCookie().find((value) => value.startsWith(`${FORM_SUBMISSION_CHAT_SESSION_COOKIE}=`));

    expect(setCookie).toMatch(new RegExp(
      `^${FORM_SUBMISSION_CHAT_SESSION_COOKIE}=fss1\\.formsub_test\\.\\d+\\.[A-Za-z0-9_-]{43};`,
      "u",
    ));
    expect(setCookie).toContain("Max-Age=2592000");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=lax");
    expect(response.headers.get("location")).not.toContain(confirmation.formSubmissionId);
    const responseBody = await response.text();
    expect(responseBody).not.toContain(confirmation.formSubmissionId);
    expect(responseBody).not.toContain(token);
  });

  it("已驗證的重複請求不再寄送確認信", async () => {
    mocks.verifyFormSubmission.mockResolvedValue({ status: "already_verified" });

    const response = await POST(request());

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://app.example.test/verify-registration?status=verified");
    expect(mocks.ensureRegistrationConfirmationDelivery).not.toHaveBeenCalled();
    expect(mocks.ensureLiveReminderDelivery).not.toHaveBeenCalled();
    expect(mocks.scheduleImmediateEmailDispatch).not.toHaveBeenCalled();
  });

  it("already_verified 只有 current claim 才重新核發 chat session cookie", async () => {
    mocks.verifyFormSubmission.mockResolvedValue({
      status: "already_verified",
      chatSession: { submissionId: confirmation.formSubmissionId },
    });

    const response = await POST(request());
    expect(response.headers.getSetCookie().some((value) => value.startsWith(`${FORM_SUBMISSION_CHAT_SESSION_COOKIE}=`))).toBe(true);
    expect(mocks.ensureRegistrationConfirmationDelivery).not.toHaveBeenCalled();

    mocks.verifyFormSubmission.mockResolvedValue({ status: "invalid" });
    const staleResponse = await POST(request());
    expect(staleResponse.headers.getSetCookie()).toEqual([]);
  });

  it("開播提醒排程失敗時保留 verified 結果並寫入去識別監控", async () => {
    const error = new Error(`reminder failed for ${confirmation.recipientEmail} ${token}`);
    mocks.verifyFormSubmission.mockResolvedValue({ status: "verified", confirmation });
    mocks.ensureLiveReminderDelivery.mockRejectedValue(error);

    const response = await POST(request());

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://app.example.test/verify-registration?status=verified");
    expect(mocks.captureOperationalError).toHaveBeenCalledWith(error, {
      source: "form_submission_verification",
      operation: "live_reminder_email_schedule",
      status: "failed",
    });
    expect(JSON.stringify(mocks.captureOperationalError.mock.calls)).not.toContain(confirmation.recipientEmail);
    expect(JSON.stringify(mocks.captureOperationalError.mock.calls)).not.toContain(token);
  });

  it("驗證成功後在回應結束時立即寄出確認信，未來的開播提醒仍留給排程", async () => {
    mocks.verifyFormSubmission.mockResolvedValue({ status: "verified", confirmation });
    mocks.ensureRegistrationConfirmationDelivery.mockResolvedValue({ status: "queued", deliveryId: "email_confirmation" });
    mocks.ensureLiveReminderDelivery.mockResolvedValue({
      status: "scheduled",
      deliveryId: "email_future_reminder",
      nextAttemptAt: new Date(Date.now() + 60 * 60_000),
    });

    const response = await POST(request());

    expect(response.status).toBe(303);
    expect(mocks.scheduleImmediateEmailDispatch).toHaveBeenCalledTimes(1);
    expect(mocks.scheduleImmediateEmailDispatch).toHaveBeenCalledWith(["email_confirmation"]);
  });

  it("在提醒時間窗內報名時，已到期的開播提醒也一併立即寄出", async () => {
    mocks.verifyFormSubmission.mockResolvedValue({ status: "verified", confirmation });
    mocks.ensureRegistrationConfirmationDelivery.mockResolvedValue({ status: "duplicate", deliveryId: "email_confirmation", deliveryStatus: "queued" });
    mocks.ensureLiveReminderDelivery.mockResolvedValue({
      status: "scheduled",
      deliveryId: "email_due_reminder",
      nextAttemptAt: new Date(Date.now() - 1_000),
    });

    await POST(request());

    expect(mocks.scheduleImmediateEmailDispatch).toHaveBeenCalledWith(["email_confirmation", "email_due_reminder"]);
  });

  it("已退訂或未設定的信件不排入立即寄送", async () => {
    mocks.verifyFormSubmission.mockResolvedValue({ status: "verified", confirmation });
    mocks.ensureRegistrationConfirmationDelivery.mockResolvedValue({ status: "suppressed", deliveryId: "email_suppressed" });
    mocks.ensureLiveReminderDelivery.mockResolvedValue({ status: "suppressed", deliveryId: "email_reminder", nextAttemptAt: null });

    await POST(request());

    expect(mocks.scheduleImmediateEmailDispatch).toHaveBeenCalledWith([]);
  });

  it("確認信排程失敗時保留 verified 結果，且監控資料不含收件人或 token", async () => {
    const error = new Error(`delivery failed for ${confirmation.recipientEmail} ${token}`);
    mocks.verifyFormSubmission.mockResolvedValue({ status: "verified", confirmation });
    mocks.ensureRegistrationConfirmationDelivery.mockRejectedValue(error);

    const response = await POST(request());

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://app.example.test/verify-registration?status=verified");
    expect(mocks.captureOperationalError).toHaveBeenCalledWith(error, {
      source: "form_submission_verification",
      operation: "confirmation_email_enqueue",
      status: "failed",
    });
    expect(JSON.stringify(mocks.captureOperationalError.mock.calls)).not.toContain(confirmation.recipientEmail);
    expect(JSON.stringify(mocks.captureOperationalError.mock.calls)).not.toContain(token);
  });
});
