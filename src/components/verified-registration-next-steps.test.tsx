import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ cookie: vi.fn(), claim: vi.fn(), find: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: mocks.cookie }) }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ formSubmission: { findFirst: mocks.find } }) }));
vi.mock("@/lib/app-url", () => ({ getCanonicalAppUrl: () => "https://example.test" }));
vi.mock("@/lib/form-submission-chat-session", () => ({
  FORM_SUBMISSION_CHAT_SESSION_COOKIE: "synthetic-session",
  verifyFormSubmissionChatSessionToken: mocks.claim,
}));
import { VerifiedRegistrationNextSteps } from "./verified-registration-next-steps";

const live = {
  id: "live-a",
  slug: "demo live",
  title: "新品發表",
  scheduledAt: new Date("2026-11-05T12:30:00.000Z"),
  status: "scheduled",
  formId: "form-a",
  vendorId: "vendor-a",
};

describe("verified registration next steps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cookie.mockReturnValue({ value: "synthetic-token" });
    mocks.claim.mockReturnValue({ submissionId: "submission-a" });
    mocks.find.mockResolvedValue({ formId: "form-a", form: { vendorId: "vendor-a" }, live });
  });

  it("renders the live room link and both calendar options for the registrant's own session", async () => {
    const html = renderToStaticMarkup(await VerifiedRegistrationNextSteps());
    expect(html).toContain('href="/live/demo%20live"');
    expect(html).toContain("前往直播間");
    expect(html).toContain("https://calendar.google.com/calendar/render?");
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('download="live-event.ics"');
    expect(html).toContain("data:text/calendar");
    expect(mocks.find).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "submission-a", verificationStatus: "VERIFIED", verifiedAt: { not: null } },
    }));
  });

  it("needs a signed session before reading any record", async () => {
    mocks.cookie.mockReturnValue(undefined);
    expect(await VerifiedRegistrationNextSteps()).toBeNull();
    mocks.cookie.mockReturnValue({ value: "bad" });
    mocks.claim.mockReturnValue(null);
    expect(await VerifiedRegistrationNextSteps()).toBeNull();
    expect(mocks.find).not.toHaveBeenCalled();
  });

  it.each([
    ["no record", null],
    ["no live", { formId: "form-a", form: { vendorId: "vendor-a" }, live: null }],
    ["live of another form", { formId: "form-a", form: { vendorId: "vendor-a" }, live: { ...live, formId: "form-b" } }],
    ["live of another vendor", { formId: "form-a", form: { vendorId: "vendor-a" }, live: { ...live, vendorId: "vendor-b" } }],
    ["ended live", { formId: "form-a", form: { vendorId: "vendor-a" }, live: { ...live, status: "ended" } }],
  ])("shows nothing for %s", async (_name, record) => {
    mocks.find.mockResolvedValue(record);
    expect(await VerifiedRegistrationNextSteps()).toBeNull();
  });
});
