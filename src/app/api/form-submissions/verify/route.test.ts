import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: { marker: "verification-db" },
  checkRateLimit: vi.fn(),
  verifyFormSubmission: vi.fn(),
  ensureRegistrationConfirmationDelivery: vi.fn(),
  ensureLiveReminderDelivery: vi.fn(),
  captureOperationalError: vi.fn(),
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

import { POST } from "./route";

const token = `fsv1.formsub_test.1780000000.1.${"a".repeat(43)}`;
const confirmation = {
  vendorId: "vendor-1",
  vendorName: "測試商家",
  liveId: "live-1",
  liveTitle: "新品直播",
  formSubmissionId: "formsub_test",
  recipientName: "王小明",
  recipientEmail: "lead@example.test",
  liveScheduledAt: new Date("2026-08-10T04:00:00.000Z"),
  liveReminderOffsetMinutes: 60,
  template: null,
  reminderTemplate: null,
};

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
  mocks.checkRateLimit.mockResolvedValue(null);
  mocks.verifyFormSubmission.mockResolvedValue({ status: "invalid" });
});

describe("POST /api/form-submissions/verify", () => {
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
    expect(mocks.verifyFormSubmission).toHaveBeenCalledWith(mocks.db, "not-a-verification-token");
    expect(mocks.ensureRegistrationConfirmationDelivery).not.toHaveBeenCalled();
    expect(mocks.ensureLiveReminderDelivery).not.toHaveBeenCalled();
  });

  it("將 domain 判定無效的 token 導向無效頁面", async () => {
    const response = await POST(request());

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://app.example.test/verify-registration?status=invalid");
    expect(mocks.verifyFormSubmission).toHaveBeenCalledWith(mocks.db, token);
    expect(mocks.ensureRegistrationConfirmationDelivery).not.toHaveBeenCalled();
    expect(mocks.ensureLiveReminderDelivery).not.toHaveBeenCalled();
  });

  it("驗證成功後才排入報名確認信", async () => {
    mocks.verifyFormSubmission.mockResolvedValue({ status: "verified", confirmation });

    const response = await POST(request());

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://app.example.test/verify-registration?status=verified");
    expect(mocks.ensureRegistrationConfirmationDelivery).toHaveBeenCalledWith(confirmation);
    expect(mocks.ensureLiveReminderDelivery).toHaveBeenCalledWith({
      ...confirmation,
      template: null,
      reminderOffsetMinutes: 60,
    });
    expect(mocks.captureOperationalError).not.toHaveBeenCalled();
  });

  it("已驗證的重複請求不再寄送確認信", async () => {
    mocks.verifyFormSubmission.mockResolvedValue({ status: "already_verified" });

    const response = await POST(request());

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://app.example.test/verify-registration?status=verified");
    expect(mocks.ensureRegistrationConfirmationDelivery).not.toHaveBeenCalled();
    expect(mocks.ensureLiveReminderDelivery).not.toHaveBeenCalled();
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
