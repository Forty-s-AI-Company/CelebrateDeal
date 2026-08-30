import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = {
  registrationForm: { findUnique: vi.fn() },
  live: { findFirst: vi.fn(), findMany: vi.fn() },
  blacklist: { findFirst: vi.fn() },
  formSubmission: { create: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), updateMany: vi.fn() },
  analyticsEvent: { create: vi.fn() },
  affiliateClick: { findFirst: vi.fn(), updateMany: vi.fn() },
  affiliate: { findFirst: vi.fn() },
  partnerLiveShare: { findFirst: vi.fn() },
  partnerFunnelPage: { findFirst: vi.fn() },
  teamMembership: { findMany: vi.fn() },
  teamMembershipRelationship: { findMany: vi.fn() },
  teamLeadAttribution: { upsert: vi.fn() },
  emailDelivery: { create: vi.fn(), findUnique: vi.fn() },
  emailSuppression: { findUnique: vi.fn() },
};

vi.mock("@/lib/db", () => ({ getDb: () => db }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(async () => null) }));

import { POST } from "@/app/api/form-submissions/route";
import { revealEmailDeliveryPayload } from "@/lib/email-delivery-pii";
import { encodeAttributionCookie } from "@/lib/team-funnel-attribution";

function pendingSubmission(id = "submission-1", values: Record<string, unknown> = {}) {
  return {
    id,
    name: "Lead",
    email: "lead@example.test",
    liveId: "live-a",
    verificationStatus: "UNVERIFIED",
    verificationVersion: 1,
    verificationExpiresAt: new Date(Date.now() + 60 * 60 * 1_000),
    ...values,
  };
}

function nativeFormRequest(redirectTo: string) {
  const body = new URLSearchParams({
    formId: "form-1",
    name: "Test User",
    email: "test@example.test",
    redirectTo,
  });
  return new Request("https://app.example.test/api/form-submissions", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      origin: "https://app.example.test",
    },
    body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CSRF_SECRET", "form-submission-email-test-secret-longer-than-32-bytes");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.test");
  db.registrationForm.findUnique.mockResolvedValue({
    id: "form-1",
    vendorId: "vendor-1",
    isActive: true,
    hideExpiredSessions: true,
    maxVisibleSessions: 1,
    vendor: {
      name: "測試商家",
      senderName: "測試寄件人",
      supportEmail: "support@example.test",
      contactUrl: "https://example.test/contact",
    },
    fields: [
      { key: "name", label: "姓名", type: "text", required: true },
      { key: "email", label: "Email", type: "email", required: true },
      { key: "phone", label: "手機", type: "tel", required: false },
    ],
  });
  db.blacklist.findFirst.mockResolvedValue(null);
  db.formSubmission.findFirst.mockResolvedValue(null);
  db.formSubmission.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => pendingSubmission(String(data.id ?? "submission-1"), {
    name: data.name,
    email: data.email,
    liveId: data.liveId,
    verificationStatus: data.verificationStatus,
    verificationVersion: data.verificationVersion,
    verificationExpiresAt: data.verificationExpiresAt,
  }));
  db.formSubmission.findUnique.mockResolvedValue(null);
  db.formSubmission.findUniqueOrThrow.mockResolvedValue(pendingSubmission());
  db.formSubmission.updateMany.mockResolvedValue({ count: 1 });
  db.analyticsEvent.create.mockResolvedValue({ id: "event-1" });
  db.affiliateClick.findFirst.mockResolvedValue(null);
  db.affiliateClick.updateMany.mockResolvedValue({ count: 0 });
  db.affiliate.findFirst.mockResolvedValue({ id: "affiliate-b" });
  db.partnerLiveShare.findFirst.mockResolvedValue(null);
  db.partnerFunnelPage.findFirst.mockResolvedValue(null);
  db.live.findFirst.mockResolvedValue({
    id: "live-a",
    title: "測試直播",
    formId: "form-1",
    seminarOwnerMembershipId: "member-a",
    vendor: { name: "測試商家" },
    messageTemplate: null,
  });
  db.live.findMany.mockResolvedValue([]);
  db.teamMembership.findMany.mockResolvedValue([]);
  db.teamMembershipRelationship.findMany.mockResolvedValue([]);
  db.teamLeadAttribution.upsert.mockResolvedValue({ id: "attribution-1" });
  db.emailSuppression.findUnique.mockResolvedValue(null);
  db.emailDelivery.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: data.id, status: data.status }));
  db.emailDelivery.findUnique.mockResolvedValue(null);
});

afterEach(() => vi.unstubAllEnvs());

describe("team lead attribution", () => {
  function jsonRequest(payload: Record<string, unknown>, url = "https://app.example.test/api/form-submissions") {
    return new Request(url, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://app.example.test", referer: "https://app.example.test/funnel/b-page", "x-celebratedeal-client": "web" },
      body: JSON.stringify(payload),
    });
  }

  it("keeps A's webinar/form but assigns B-promoted lead using server-resolved lineage", async () => {
    db.partnerFunnelPage.findFirst.mockResolvedValue({
      id: "page-b", teamId: "team-1", templateVersionId: "version-a", promoterMembershipId: "member-b", contentOwnerMembershipId: "member-a",
      sharing: { accessMode: "PUBLIC", isEnabled: true, expiresAt: null },
    });
    db.teamMembership.findMany.mockResolvedValue([{ id: "member-a", affiliateId: "affiliate-a" }, { id: "member-b", affiliateId: "affiliate-b" }]);
    db.teamMembershipRelationship.findMany.mockResolvedValue([{ uplineMembershipId: "member-a", downlineMembershipId: "member-b" }]);

    const response = await POST(jsonRequest({
      formId: "form-1", liveId: "live-a", referralCode: "b-code",
      payload: { name: "Lead", email: "lead@example.test" }, ownerId: "attacker",
    }));

    expect(response.status).toBe(200);
    expect(db.formSubmission.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ formId: "form-1", liveId: "live-a" }) }));
    expect(db.teamLeadAttribution.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ promoterMembershipId: "member-b", contentOwnerMembershipId: "member-a", seminarOwnerMembershipId: "member-a", pageId: "page-b" }),
    }));
  });

  it("makes a repeated registration idempotent", async () => {
    db.formSubmission.findFirst.mockResolvedValue(pendingSubmission("submission-existing"));
    db.partnerFunnelPage.findFirst.mockResolvedValue({
      id: "page-b",
      teamId: "team-1",
      templateVersionId: "version-a",
      promoterMembershipId: "member-b",
      contentOwnerMembershipId: "member-a",
      sharing: { accessMode: "PUBLIC", isEnabled: true, expiresAt: null },
    });
    const response = await POST(jsonRequest({
      formId: "form-1",
      liveId: "live-a",
      referralCode: "b-code",
      payload: { name: "Lead", email: "lead@example.test" },
    }));

    await expect(response.json()).resolves.toEqual({ ok: true, verificationRequired: true });
    expect(response.headers.getSetCookie().join("\n")).toContain("celebratedeal_form_submission=submission-existing");
    expect(db.formSubmission.create).not.toHaveBeenCalled();
    expect(db.teamLeadAttribution.upsert).not.toHaveBeenCalled();
  });

  it("normalizes email identity and keeps an unverified submission out of canonical analytics", async () => {
    const response = await POST(jsonRequest({
      formId: "form-1",
      liveId: "live-a",
      payload: { name: "Lead", email: " Lead@Example.Test " },
    }));

    expect(response.status).toBe(200);
    expect(db.formSubmission.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: "lead@example.test",
        answers: expect.objectContaining({ email: "lead@example.test" }),
      }),
      select: expect.objectContaining({ id: true, verificationStatus: true }),
    });
    expect(db.analyticsEvent.create).not.toHaveBeenCalled();
    expect(JSON.stringify(db.analyticsEvent.create.mock.calls)).not.toContain("lead@example.test");
  });

  it("requires a selected live id when the public form has visible sessions, regardless of maxVisibleSessions", async () => {
    db.live.findMany.mockResolvedValue([
      { status: "live", scheduledAt: new Date(Date.now() + 60 * 60 * 1_000) },
      { status: "scheduled", scheduledAt: new Date(Date.now() + 2 * 60 * 60 * 1_000) },
    ]);

    const response = await POST(jsonRequest({
      formId: "form-1",
      payload: { name: "Lead", email: "lead@example.test" },
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Live session selection required" });
    expect(db.formSubmission.create).not.toHaveBeenCalled();
    expect(db.live.findMany).toHaveBeenCalledWith({
      where: {
        formId: "form-1",
        vendorId: "vendor-1",
        OR: [
          { status: { in: ["scheduled", "live"] } },
          { status: "ended", replayEnabled: true },
        ],
      },
      select: { scheduledAt: true, status: true },
    });
  });

  it("keeps ordinary registration when the public form has no visible sessions", async () => {
    db.live.findMany.mockResolvedValue([]);

    const response = await POST(jsonRequest({
      formId: "form-1",
      payload: { name: "Lead", email: "lead@example.test" },
    }));

    expect(response.status).toBe(200);
    expect(db.formSubmission.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ liveId: null, source: "form" }),
    }));
  });

  it("does not require a live id for a stale scheduled session hidden by the form", async () => {
    db.live.findMany.mockResolvedValue([
      { status: "scheduled", scheduledAt: new Date(Date.now() - 60 * 60 * 1_000) },
    ]);

    const response = await POST(jsonRequest({
      formId: "form-1",
      payload: { name: "Lead", email: "lead@example.test" },
    }));

    expect(response.status).toBe(200);
    expect(db.formSubmission.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ liveId: null, source: "form" }),
    }));
  });

  it.each([
    ["forged", null],
    ["expired replay", null],
    ["cross-tenant", null],
  ])("continues rejecting a %s direct live id through the existing lifecycle and tenant gate", async (_label, live) => {
    db.live.findFirst.mockResolvedValue(live);

    const response = await POST(jsonRequest({
      formId: "form-1",
      liveId: "live-forged",
      payload: { name: "Lead", email: "lead@example.test" },
    }));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Live not found" });
    expect(db.formSubmission.create).not.toHaveBeenCalled();
    expect(db.live.findMany).not.toHaveBeenCalled();
  });

  it("queues one encrypted ownership-verification Email before confirmation", async () => {
    db.live.findFirst.mockResolvedValue({
      id: "live-a",
      title: "新品直播",
      quotaPolicy: null,
      vendor: { name: "測試商家" },
      messageTemplate: {
        id: "template-1",
        vendorId: "vendor-1",
        channel: "email",
        trigger: "registration_confirmed",
        subject: "{{name}} 報名成功",
        body: "{{live_title}}\n{{unsubscribe_url}}",
        isActive: true,
      },
    });

    const response = await POST(jsonRequest({
      formId: "form-1",
      liveId: "live-a",
      vendorId: "attacker-vendor",
      payload: { name: "Lead", email: "lead@example.test" },
    }));

    expect(response.status).toBe(200);
    const create = db.emailDelivery.create.mock.calls[0]?.[0];
    expect(create.data).toMatchObject({
      vendorId: "vendor-1",
      sourceFormSubmissionId: expect.stringMatching(/^formsub_[a-f0-9]{32}$/),
      sourceLiveId: "live-a",
      sourceTemplateId: "system_form_submission_verification_v1",
      trigger: "form_submission_verification",
      recipientMaskedEmail: "l***@example.test",
      status: "queued",
    });
    expect(revealEmailDeliveryPayload(create.data.payloadEncryptedEnvelope, {
      vendorId: "vendor-1",
      deliveryId: create.data.id,
    }).brand).toEqual({
      version: 1,
      senderName: "測試寄件人",
      replyTo: "support@example.test",
      contactUrl: "https://example.test/contact",
    });
    expect(db.registrationForm.findUnique).toHaveBeenCalledWith({
      where: { id: "form-1" },
      include: {
        vendor: { select: { name: true, senderName: true, supportEmail: true, contactUrl: true } },
      },
    });
    expect(JSON.stringify(create)).not.toContain("lead@example.test");
    expect(JSON.stringify(create)).not.toContain("Lead 報名成功");
    expect(JSON.stringify(create)).not.toContain("測試寄件人");
    expect(JSON.stringify(create)).not.toContain("support@example.test");
  });

  it("uses the same normalized email and phone values for blacklist checks and persistence", async () => {
    const response = await POST(jsonRequest({
      formId: "form-1",
      payload: {
        name: "Lead",
        email: " Blocked@Example.Test ",
        phone: " +886 (912) 345-678 ",
      },
    }));

    expect(response.status).toBe(200);
    expect(db.blacklist.findFirst).toHaveBeenCalledWith({
      where: {
        vendorId: "vendor-1",
        isActive: true,
        OR: [
          { identifierType: "email", identifier: "blocked@example.test" },
          { identifierType: "phone", identifier: "+886912345678" },
        ],
      },
    });
    expect(db.formSubmission.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: "blocked@example.test",
        phone: "+886912345678",
        answers: expect.objectContaining({
          email: "blocked@example.test",
          phone: "+886912345678",
        }),
      }),
      select: expect.objectContaining({ id: true, verificationStatus: true }),
    });
  });

  it("rejects unconfigured answers and overlong contact data before persistence", async () => {
    for (const payload of [
      { name: "Lead", email: "lead@example.test", token: "sensitive-token" },
      { name: "Lead", email: "not-an-email" },
      { name: "x".repeat(161), email: "lead@example.test" },
      { name: "Lead", email: "lead@example.test", phone: "1".repeat(41) },
    ]) {
      const response = await POST(jsonRequest({ formId: "form-1", payload }));
      expect(response.status).toBe(400);
    }

    expect(db.formSubmission.create).not.toHaveBeenCalled();
  });

  it("enforces visual-builder field types at the server boundary", async () => {
    db.registrationForm.findUnique.mockResolvedValue({
      id: "form-1",
      vendorId: "vendor-1",
      isActive: true,
      vendor: { name: "測試商家" },
      fields: [
        { key: "name", label: "姓名", type: "text", required: true },
        { key: "email", label: "Email", type: "email", required: true },
        { key: "website", label: "網站", type: "url", required: true },
        { key: "guests", label: "人數", type: "number", required: true },
      ],
    });

    for (const payload of [
      { name: "Lead", email: "lead@example.test", website: "javascript:alert(1)", guests: "2" },
      { name: "Lead", email: "lead@example.test", website: "https://example.test", guests: "not-a-number" },
    ]) {
      const response = await POST(jsonRequest({ formId: "form-1", payload }));
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: "Invalid form answers" });
    }

    expect(db.formSubmission.create).not.toHaveBeenCalled();
  });

  it("stores normalized custom field answers after type validation", async () => {
    db.registrationForm.findUnique.mockResolvedValue({
      id: "form-1",
      vendorId: "vendor-1",
      isActive: true,
      vendor: { name: "測試商家" },
      fields: [
        { key: "name", label: "姓名", type: "text", required: true },
        { key: "email", label: "Email", type: "email", required: true },
        { key: "website", label: "網站", type: "url", required: true },
        { key: "guests", label: "人數", type: "number", required: true },
      ],
    });

    const response = await POST(jsonRequest({
      formId: "form-1",
      payload: { name: " Lead ", email: " Lead@Example.Test ", website: " https://example.test/path ", guests: " 2.5 " },
    }));

    expect(response.status).toBe(200);
    expect(db.formSubmission.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        answers: {
          name: "Lead",
          email: "lead@example.test",
          website: "https://example.test/path",
          guests: "2.5",
        },
      }),
      select: expect.objectContaining({ id: true, verificationStatus: true }),
    });
  });

  it("turns a concurrent deterministic-ID conflict into an idempotent success", async () => {
    db.formSubmission.create.mockRejectedValue({ code: "P2002" });
    db.formSubmission.findUnique.mockResolvedValue(pendingSubmission("formsub-concurrent"));

    const response = await POST(jsonRequest({
      formId: "form-1",
      payload: { name: "Lead", email: "lead@example.test" },
    }));

    await expect(response.json()).resolves.toEqual({ ok: true, verificationRequired: true });
    expect(db.formSubmission.findUnique).toHaveBeenCalledWith({
      where: { id: expect.stringMatching(/^formsub_[a-f0-9]{32}$/) },
      select: expect.objectContaining({ id: true, verificationStatus: true }),
    });
    expect(db.teamLeadAttribution.upsert).not.toHaveBeenCalled();
  });

  it("stores the created registration ID in a short-lived HttpOnly cookie", async () => {
    const response = await POST(jsonRequest({ formId: "form-1", payload: { name: "Lead", email: "lead@example.test" } }));

    const cookies = response.headers.getSetCookie().join("\n");
    expect(cookies).toMatch(/celebratedeal_form_submission=formsub_[a-f0-9]{32}/u);
    expect(cookies).toContain("HttpOnly");
    expect(cookies).toContain("Secure");
    expect(cookies).toContain("SameSite=lax");
    expect(cookies).toContain("Max-Age=1800");
  });

  it("does not attribute a forged cross-tenant page", async () => {
    db.partnerFunnelPage.findFirst.mockResolvedValue(null);
    await POST(jsonRequest({
      formId: "form-1", liveId: "live-a", referralCode: "b-code",
      payload: { name: "Lead", email: "lead@example.test" },
    }));

    expect(db.teamLeadAttribution.upsert).not.toHaveBeenCalled();
  });

  it("records a lead only when the opaque Live share resolves to the exact vendor and live", async () => {
    const shareCode = `tls1.${"a".repeat(43)}`;
    db.partnerLiveShare.findFirst.mockResolvedValue({
      vendorId: "vendor-1",
      teamId: "team-1",
      liveId: "live-a",
      sourcePageId: "page-a",
      promoterMembershipId: "member-b",
      expiresAt: null,
      isEnabled: true,
      sourcePage: {
        teamId: "team-1",
        liveId: "live-a",
        templateVersionId: "version-a",
        promoterMembershipId: "member-a",
        contentOwnerMembershipId: "member-a",
      },
      live: {
        teamId: "team-1",
        seminarOwnerMembershipId: "member-a",
        status: "live",
        replayEnabled: false,
      },
    });
    db.teamMembership.findMany.mockResolvedValue([
      {
        id: "member-a",
        vendorId: "vendor-1",
        teamId: "team-1",
        vendorMemberId: "vendor-member-a",
        status: "ACTIVE",
        leftAt: null,
        affiliate: null,
        vendorMember: { userId: "user-a", status: "active", deactivatedAt: null },
      },
      {
        id: "member-b",
        vendorId: "vendor-1",
        teamId: "team-1",
        vendorMemberId: "vendor-member-b",
        status: "ACTIVE",
        leftAt: null,
        affiliate: { code: "B-CODE", isActive: true },
        vendorMember: { userId: "user-b", status: "active", deactivatedAt: null },
      },
    ]);
    db.teamMembershipRelationship.findMany.mockResolvedValue([{
      teamId: "team-1",
      uplineMembershipId: "member-a",
      downlineMembershipId: "member-b",
      effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
      endedAt: null,
    }]);

    const response = await POST(jsonRequest({
      formId: "form-1",
      liveId: "live-a",
      shareCode,
      payload: { name: "Lead", email: "lead@example.test" },
    }));

    expect(response.status).toBe(200);
    expect(db.partnerLiveShare.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        vendorId: "vendor-1",
        liveId: "live-a",
        tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    }));
    expect(db.teamLeadAttribution.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        pageId: "page-a",
        promoterMembershipId: "member-b",
        contentOwnerMembershipId: "member-a",
        seminarOwnerMembershipId: "member-a",
        referralCode: "B-CODE",
      }),
    }));
  });

  it.each([
    ["missing or cross-live", null],
    ["disabled", { isEnabled: false, expiresAt: null }],
    ["expired", { isEnabled: true, expiresAt: new Date("2000-01-01T00:00:00.000Z") }],
  ])("rejects a %s Live share before creating or deduplicating a submission", async (_label, state) => {
    const shareCode = `tls1.${"b".repeat(43)}`;
    db.formSubmission.findFirst.mockResolvedValue({ id: "submission-existing" });
    db.partnerLiveShare.findFirst.mockResolvedValue(state ? {
      vendorId: "vendor-1",
      teamId: "team-1",
      liveId: "live-a",
      sourcePageId: "page-a",
      promoterMembershipId: "member-b",
      ...state,
      sourcePage: {
        teamId: "team-1",
        liveId: "live-a",
        templateVersionId: "version-a",
        promoterMembershipId: "member-a",
        contentOwnerMembershipId: "member-a",
      },
      live: { teamId: "team-1", seminarOwnerMembershipId: "member-a", status: "live", replayEnabled: false },
    } : null);

    const response = await POST(jsonRequest({
      formId: "form-1",
      liveId: "live-a",
      shareCode,
      payload: { name: "Lead", email: "lead@example.test" },
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Live share unavailable" });
    expect(db.formSubmission.create).not.toHaveBeenCalled();
    expect(db.teamLeadAttribution.upsert).not.toHaveBeenCalled();
  });

  it("does not resolve or convert legacy attribution when the live policy disables it", async () => {
    db.live.findFirst.mockResolvedValue({
      id: "live-a",
      title: "測試直播",
      formId: "form-1",
      seminarOwnerMembershipId: "member-a",
      quotaPolicy: { affiliateMode: "disabled" },
      vendor: { name: "測試商家" },
      messageTemplate: null,
    });

    const response = await POST(jsonRequest({
      formId: "form-1",
      liveId: "live-a",
      referralCode: "b-code",
      payload: { name: "Lead", email: "lead@example.test" },
    }));

    expect(response.status).toBe(200);
    expect(db.affiliate.findFirst).not.toHaveBeenCalled();
    expect(db.affiliateClick.updateMany).not.toHaveBeenCalled();
  });

  it("stores only the server-validated click and defers conversion until Email verification", async () => {
    db.affiliateClick.findFirst.mockResolvedValue({ referralCode: "B-CODE", affiliateId: "affiliate-b" });
    const attributionCookie = encodeAttributionCookie({
      clickId: "click-target",
      visitorId: "visitor-target-1234567890",
      issuedAt: Date.now(),
    });
    const request = new Request("https://app.example.test/api/form-submissions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://app.example.test",
        referer: "https://app.example.test/live/public-live",
        cookie: `celebratedeal_attribution=${attributionCookie}; celebratedeal_visitor=visitor-target-1234567890`,
        "x-celebratedeal-client": "web",
      },
      body: JSON.stringify({
        formId: "form-1",
        liveId: "live-a",
        payload: { name: "Lead", email: "lead@example.test" },
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(db.formSubmission.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ affiliateClickId: "click-target", verificationStatus: "UNVERIFIED" }),
    }));
    expect(db.affiliateClick.updateMany).not.toHaveBeenCalled();
  });

  it("ignores a signed attribution cookie replayed by a different visitor", async () => {
    db.affiliateClick.findFirst.mockResolvedValue({ referralCode: "B-CODE", affiliateId: "affiliate-b" });
    const attributionCookie = encodeAttributionCookie({
      clickId: "click-target",
      visitorId: "visitor-target-1234567890",
      issuedAt: Date.now(),
    });
    const request = new Request("https://app.example.test/api/form-submissions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://app.example.test",
        referer: "https://app.example.test/live/public-live",
        cookie: `celebratedeal_attribution=${attributionCookie}; celebratedeal_visitor=different-visitor-1234567890`,
        "x-celebratedeal-client": "web",
      },
      body: JSON.stringify({
        formId: "form-1",
        liveId: "live-a",
        payload: { name: "Lead", email: "lead@example.test" },
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(db.affiliateClick.findFirst).not.toHaveBeenCalled();
    expect(db.formSubmission.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ affiliateClickId: null }),
    }));
  });

  it("does not bind an unrelated attribution cookie when an explicit referral wins", async () => {
    const attributionCookie = encodeAttributionCookie({
      clickId: "foreign-click",
      visitorId: "foreign-visitor-1234567890",
      issuedAt: Date.now(),
    });
    const request = new Request("https://app.example.test/api/form-submissions?ref=b-code", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://app.example.test",
        referer: "https://app.example.test/live/public-live?ref=b-code",
        cookie: `celebratedeal_attribution=${attributionCookie}`,
        "x-celebratedeal-client": "web",
      },
      body: JSON.stringify({
        formId: "form-1",
        liveId: "live-a",
        payload: { name: "Lead", email: "lead@example.test" },
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(db.formSubmission.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ affiliateClickId: null }),
    }));
    expect(db.affiliateClick.findFirst).not.toHaveBeenCalled();
  });

  it("rejects a webinar that is not bound to the submitted form", async () => {
    db.live.findFirst.mockResolvedValue(null);

    const response = await POST(jsonRequest({
      formId: "form-1", liveId: "live-a", payload: { name: "Lead", email: "lead@example.test" },
    }));

    expect(response.status).toBe(404);
    expect(db.live.findFirst).toHaveBeenCalledWith({
      where: {
        id: "live-a",
        vendorId: "vendor-1",
        formId: "form-1",
        OR: [
          { status: { in: ["scheduled", "live"] } },
          { status: "ended", replayEnabled: true },
        ],
      },
      select: {
        id: true,
        title: true,
        quotaPolicy: true,
        vendor: { select: { name: true } },
        messageTemplate: {
          select: {
            id: true,
            vendorId: true,
            channel: true,
            trigger: true,
            subject: true,
            body: true,
            isActive: true,
          },
        },
      },
    });
    expect(db.formSubmission.create).not.toHaveBeenCalled();
  });
});

describe("native form submission redirects", () => {
  it("rejects native submissions without an Origin before reading or writing form data", async () => {
    const body = new URLSearchParams({
      formId: "form-1",
      name: "Lead",
      email: "lead@example.test",
    });
    const response = await POST(new Request("https://app.example.test/api/form-submissions", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    }));

    expect(response.status).toBe(403);
    expect(db.registrationForm.findUnique).not.toHaveBeenCalled();
    expect(db.formSubmission.create).not.toHaveBeenCalled();
  });

  it("keeps a root-relative redirect on the request origin", async () => {
    const response = await POST(nativeFormRequest("/forms/summer?source=landing"));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://app.example.test/forms/summer?source=landing&submitted=verification_required",
    );
  });

  it.each(["//attacker.example.test/collect", "/\\attacker.example.test/collect"])(
    "does not redirect a cross-origin relative-looking value (%s)",
    async (redirectTo) => {
      const response = await POST(nativeFormRequest(redirectTo));

      expect(response.status).toBe(200);
      expect(response.headers.get("location")).toBeNull();
      await expect(response.json()).resolves.toEqual({ ok: true, verificationRequired: true });
    },
  );

  it("rejects an oversized native body without querying or writing form data", async () => {
    const body = new URLSearchParams({
      formId: "form-1",
      name: "x".repeat(70 * 1024),
      email: "lead@example.test",
    });
    const response = await POST(new Request("https://app.example.test/api/form-submissions", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: "https://app.example.test",
      },
      body,
    }));

    expect(response.status).toBe(400);
    expect(db.registrationForm.findUnique).not.toHaveBeenCalled();
    expect(db.formSubmission.create).not.toHaveBeenCalled();
  });
});
