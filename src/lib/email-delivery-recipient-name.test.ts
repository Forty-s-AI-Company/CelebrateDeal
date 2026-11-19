import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  materializeLiveNotificationsForSubmission: vi.fn(),
  db: {
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
    emailDelivery: { create: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
    emailSuppression: { findUnique: vi.fn() },
    blacklist: { findFirst: vi.fn() },
    liveReminderReconciliationJob: { findFirst: vi.fn() },
  },
}));

vi.mock("@/lib/db", () => ({ getDb: () => mocks.db }));
vi.mock("@/lib/audit", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/lib/monitoring", () => ({ captureOperationalError: vi.fn() }));
vi.mock("@/lib/live-notification-delivery", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/live-notification-delivery")>()),
  materializeLiveNotificationsForSubmission: mocks.materializeLiveNotificationsForSubmission,
}));

import { revealEmailDeliveryPayload } from "@/lib/email-delivery-pii";
import {
  ensureFixedSessionAlreadyRegisteredDelivery,
  ensureFixedSessionCancelledDelivery,
  ensureFormSubmissionVerificationDelivery,
  ensureLiveReminderDelivery,
  ensurePostLiveFollowupDelivery,
  ensureRegistrationConfirmationDelivery,
} from "@/lib/email-delivery";
import { MESSAGE_TEMPLATE_NAME_FALLBACK } from "@/lib/message-template";
import {
  expectNoFormatting,
  expectNoPhishingTrace,
  NORMAL_NAMES,
  PHISHING_NAMES,
  renderedForms,
  STACKED_FORMAT_NAME,
} from "@/test/recipient-name-cases";

/**
 * A2-13: every e-mail in email-delivery.ts that greets the recipient by the
 * name typed into a public form. The payload is read back exactly as stored
 * and rendered as the HTML and plain-text parts the dispatcher sends.
 */

const brand = { senderName: "測試品牌", supportEmail: "support@example.test", contactUrl: "https://example.test/contact" };
const base = {
  vendorId: "vendor-1",
  vendorName: "測試商家",
  liveId: "live-1",
  liveSlug: "new-product-live",
  liveTitle: "新品直播",
  formSubmissionId: "submission-1",
  recipientEmail: "lead@example.test",
  liveScheduledAt: new Date("2026-08-08T04:00:00.000Z"),
  emailBrand: brand,
};
const template = (trigger: string) => ({
  id: `template-${trigger}`,
  vendorId: "vendor-1",
  channel: "email",
  trigger,
  subject: "{{name}}，{{live_title}}",
  body: "{{name}} 你好\n直播入口：{{live_url}}\n退訂：{{unsubscribe_url}}",
  isActive: true,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CSRF_SECRET", "a2-13-recipient-name-test-secret-longer-than-32-bytes");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.test");
  mocks.db.$transaction.mockImplementation(async (callback: (db: typeof mocks.db) => unknown) => callback(mocks.db));
  mocks.db.$executeRaw.mockResolvedValue(1);
  mocks.db.emailDelivery.create.mockImplementation(async ({ data }: { data: { id: string; status: string; nextAttemptAt?: Date } }) => ({ id: data.id, status: data.status, nextAttemptAt: data.nextAttemptAt ?? null }));
  mocks.db.emailDelivery.findUnique.mockResolvedValue(null);
  mocks.db.emailDelivery.findFirst.mockResolvedValue(null);
  mocks.db.emailDelivery.updateMany.mockResolvedValue({ count: 0 });
  mocks.db.emailDelivery.count.mockResolvedValue(0);
  mocks.db.emailSuppression.findUnique.mockResolvedValue(null);
  mocks.db.blacklist.findFirst.mockResolvedValue(null);
  mocks.materializeLiveNotificationsForSubmission.mockResolvedValue([]);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/** The subject and body of the last queued delivery, as stored. */
function lastQueuedMail() {
  const calls = mocks.db.emailDelivery.create.mock.calls;
  const data = calls[calls.length - 1]![0].data as { id: string; vendorId: string; payloadEncryptedEnvelope: string };
  const payload = revealEmailDeliveryPayload(data.payloadEncryptedEnvelope, { vendorId: data.vendorId, deliveryId: data.id });
  return { subject: payload.subject, body: payload.body };
}

type Path = {
  label: string;
  /** The greeting the path uses when the name cannot be used, at the very start of the body. */
  greeting: string;
  /** Whether the name also appears in the subject. */
  inSubject: boolean;
  queue: (recipientName: string) => Promise<unknown>;
};

const queueVerification = (recipientName: string) => ensureFormSubmissionVerificationDelivery({
  vendorId: "vendor-1", vendorName: "測試商家", liveId: "live-1", formSubmissionId: "formsub_0123456789abcdef0123456789abcdef",
  recipientName, recipientEmail: "lead@example.test", verificationVersion: 1, verificationExpiresAt: new Date("2026-08-11T00:00:00.000Z"), emailBrand: brand,
});

describe("form submission verification: an unconfirmed address never gets the typed name (A2-13, #670 MINOR-1)", () => {
  it.each([
    ...PHISHING_NAMES.map((entry) => entry.name),
    STACKED_FORMAT_NAME.name,
    ...NORMAL_NAMES,
  ])("opens with 您好： whatever the name (%j)", async (name) => {
    await queueVerification(name);
    const mail = lastQueuedMail();
    expect(mail.body.startsWith("您好：\n\n請開啟以下連結")).toBe(true);
    expectNoPhishingTrace(mail);
    expectNoFormatting(mail);
    const cleanedNormal = NORMAL_NAMES.find((normal) => normal === name);
    if (cleanedNormal) for (const form of Object.values(renderedForms(mail))) expect(form).not.toContain(cleanedNormal);
  });
});

const PATHS: Path[] = [
  {
    label: "fixed session already registered (verified registration)",
    greeting: "您好",
    inSubject: false,
    queue: (recipientName) => ensureFixedSessionAlreadyRegisteredDelivery({
      ...base, sessionId: "session-1", sessionLabel: "8/8 12:00", targetSessionId: "session-2", recipientName, recipientVerified: true,
    }, new Date("2026-08-01T00:00:00.000Z")),
  },
  {
    label: "fixed session cancelled",
    greeting: "您好",
    inSubject: false,
    queue: (recipientName) => ensureFixedSessionCancelledDelivery({
      ...base, sessionId: "session-1", sessionStartAt: base.liveScheduledAt, cancelledAt: new Date("2026-08-01T00:00:00.000Z"),
      recipientName, rechooseUrl: "https://app.example.test/live/new-product-live",
    }),
  },
  {
    label: "registration confirmed ({{name}} template)",
    greeting: MESSAGE_TEMPLATE_NAME_FALLBACK,
    inSubject: true,
    queue: (recipientName) => ensureRegistrationConfirmationDelivery({ ...base, recipientName, template: template("registration_confirmed") }),
  },
  {
    label: "live reminder ({{name}} template)",
    greeting: MESSAGE_TEMPLATE_NAME_FALLBACK,
    inSubject: true,
    queue: (recipientName) => ensureLiveReminderDelivery({
      ...base, recipientName, reminderOffsetMinutes: 60, template: template("live_reminder"),
    }, new Date("2026-08-07T00:00:00.000Z")),
  },
  {
    label: "post-live follow-up ({{name}} template)",
    greeting: MESSAGE_TEMPLATE_NAME_FALLBACK,
    inSubject: true,
    queue: (recipientName) => ensurePostLiveFollowupDelivery({
      ...base, recipientName, template: template("post_live_followup"),
      rule: { id: "rule-1", vendorId: "vendor-1", liveId: "live-1", trigger: "post_live_followup", offsetMinutes: 30, isActive: true },
      streamMode: "vod", endedAt: null, videoDurationSec: 3_600, verificationStatus: "VERIFIED",
    }, new Date("2026-08-08T06:00:00.000Z")),
  },
];

describe.each(PATHS)("$label (A2-13)", (path) => {
  it.each(PHISHING_NAMES)("replaces a phishing name with the greeting: $label", async ({ name }) => {
    await path.queue(name);
    const mail = lastQueuedMail();
    expectNoPhishingTrace(mail);
    expect(mail.body.startsWith(`${path.greeting}`)).toBe(true);
    if (path.inSubject) expect(mail.subject.startsWith(`${path.greeting}，`)).toBe(true);
  });

  it("removes a stacked line-start format prefix", async () => {
    await path.queue(STACKED_FORMAT_NAME.name);
    const mail = lastQueuedMail();
    expectNoFormatting(mail);
    expect(mail.body.startsWith(STACKED_FORMAT_NAME.cleaned)).toBe(true);
  });

  it.each(NORMAL_NAMES)("keeps an ordinary name: %s", async (name) => {
    await path.queue(name);
    const mail = lastQueuedMail();
    expect(mail.body.startsWith(name)).toBe(true);
    if (path.inSubject) expect(mail.subject.startsWith(`${name}，`)).toBe(true);
    const { text, html } = renderedForms(mail);
    expect(text).toContain(name);
    expect(html).toContain(name.replaceAll("'", "&#39;"));
  });
});

describe("live reminder reactivation re-renders the stored content (A2-13, #670 MINOR-2)", () => {
  it("rewrites the payload of a superseded reminder that comes back, instead of reviving the old snapshot", async () => {
    const conflict = Object.assign(new Error("unique"), { code: "P2002" });
    mocks.db.emailDelivery.create.mockRejectedValueOnce(conflict);
    mocks.db.emailDelivery.findUnique.mockResolvedValueOnce({ id: "email_existing", status: "superseded", nextAttemptAt: null, updatedAt: new Date("2026-08-01T00:00:00.000Z") });
    mocks.db.emailDelivery.updateMany.mockResolvedValue({ count: 1 });
    await expect(ensureLiveReminderDelivery({
      ...base, recipientName: "[點我](https://evil.test/login)", reminderOffsetMinutes: 60, template: template("live_reminder"),
    }, new Date("2026-08-07T00:00:00.000Z"))).resolves.toMatchObject({ status: "reactivated" });

    const reactivation = mocks.db.emailDelivery.updateMany.mock.calls
      .map((call) => call[0] as { where: { id?: string; status?: string }; data: { payloadEncryptedEnvelope?: string; status?: string } })
      .find((call) => call.where.status === "superseded" && call.data.status === "queued");
    expect(reactivation?.data.payloadEncryptedEnvelope).toEqual(expect.any(String));
    const deliveryId = mocks.db.emailDelivery.create.mock.calls[0]![0].data.id as string;
    const payload = revealEmailDeliveryPayload(reactivation!.data.payloadEncryptedEnvelope!, { vendorId: "vendor-1", deliveryId });
    expectNoPhishingTrace(payload);
    expect(payload.body.startsWith(`${MESSAGE_TEMPLATE_NAME_FALLBACK} 你好\n`)).toBe(true);
  });
});

describe("fixed session already registered: an unconfirmed registration (A2-13)", () => {
  it("never greets by the registration's name until it is VERIFIED", async () => {
    for (const recipientVerified of [false, undefined]) {
      await ensureFixedSessionAlreadyRegisteredDelivery({
        ...base, sessionId: "session-1", sessionLabel: "8/8 12:00", targetSessionId: "session-2", recipientName: "王小明",
        ...(recipientVerified === undefined ? {} : { recipientVerified }),
      }, new Date("2026-08-01T00:00:00.000Z"));
      const mail = lastQueuedMail();
      expect(mail.body.startsWith("您好：")).toBe(true);
      expect(mail.body).not.toContain("王小明");
    }
  });
});
