import { beforeEach, describe, expect, it, vi } from "vitest";

const db = {
  registrationForm: { findUnique: vi.fn() },
  live: { findFirst: vi.fn() },
  blacklist: { findFirst: vi.fn() },
  formSubmission: { create: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn() },
  analyticsEvent: { create: vi.fn() },
  affiliateClick: { updateMany: vi.fn() },
  affiliate: { findFirst: vi.fn() },
  partnerFunnelPage: { findFirst: vi.fn() },
  teamMembership: { findMany: vi.fn() },
  teamMembershipRelationship: { findMany: vi.fn() },
  teamLeadAttribution: { upsert: vi.fn() },
};

vi.mock("@/lib/db", () => ({ getDb: () => db }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(async () => null) }));

import { POST } from "@/app/api/form-submissions/route";

function nativeFormRequest(redirectTo: string) {
  const body = new URLSearchParams({
    formId: "form-1",
    name: "Test User",
    email: "test@example.test",
    redirectTo,
  });
  return new Request("https://app.example.test/api/form-submissions", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  db.registrationForm.findUnique.mockResolvedValue({
    id: "form-1",
    vendorId: "vendor-1",
    isActive: true,
    fields: [
      { key: "name", label: "姓名", type: "text", required: true },
      { key: "email", label: "Email", type: "email", required: true },
      { key: "phone", label: "手機", type: "tel", required: false },
    ],
  });
  db.blacklist.findFirst.mockResolvedValue(null);
  db.formSubmission.findFirst.mockResolvedValue(null);
  db.formSubmission.create.mockResolvedValue({ id: "submission-1" });
  db.formSubmission.findUnique.mockResolvedValue(null);
  db.analyticsEvent.create.mockResolvedValue({ id: "event-1" });
  db.affiliateClick.updateMany.mockResolvedValue({ count: 0 });
  db.affiliate.findFirst.mockResolvedValue({ id: "affiliate-b" });
  db.partnerFunnelPage.findFirst.mockResolvedValue(null);
  db.live.findFirst.mockResolvedValue({ id: "live-a", formId: "form-1", seminarOwnerMembershipId: "member-a" });
  db.teamMembership.findMany.mockResolvedValue([]);
  db.teamMembershipRelationship.findMany.mockResolvedValue([]);
  db.teamLeadAttribution.upsert.mockResolvedValue({ id: "attribution-1" });
});

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
    db.formSubmission.findFirst.mockResolvedValue({ id: "submission-existing" });
    const response = await POST(jsonRequest({ formId: "form-1", payload: { name: "Lead", email: "lead@example.test" } }));

    await expect(response.json()).resolves.toEqual({ ok: true, duplicate: true });
    expect(response.headers.getSetCookie().join("\n")).toContain("celebratedeal_form_submission=submission-existing");
    expect(db.formSubmission.create).not.toHaveBeenCalled();
    expect(db.teamLeadAttribution.upsert).not.toHaveBeenCalled();
  });

  it("normalizes email identity and never stores it as the analytics visitor ID", async () => {
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
      select: { id: true },
    });
    expect(db.analyticsEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        visitorId: "submission-1",
        eventType: "lead_submit",
      }),
    });
    expect(JSON.stringify(db.analyticsEvent.create.mock.calls)).not.toContain("lead@example.test");
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
      select: { id: true },
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

  it("turns a concurrent deterministic-ID conflict into an idempotent success", async () => {
    db.formSubmission.create.mockRejectedValue({ code: "P2002" });
    db.formSubmission.findUnique.mockResolvedValue({ id: "formsub-concurrent" });

    const response = await POST(jsonRequest({
      formId: "form-1",
      payload: { name: "Lead", email: "lead@example.test" },
    }));

    await expect(response.json()).resolves.toEqual({ ok: true, duplicate: true });
    expect(db.formSubmission.findUnique).toHaveBeenCalledWith({
      where: { id: expect.stringMatching(/^formsub_[a-f0-9]{32}$/) },
      select: { id: true },
    });
  });

  it("stores the created registration ID in a short-lived HttpOnly cookie", async () => {
    const response = await POST(jsonRequest({ formId: "form-1", payload: { name: "Lead", email: "lead@example.test" } }));

    const cookies = response.headers.getSetCookie().join("\n");
    expect(cookies).toContain("celebratedeal_form_submission=submission-1");
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

  it("rejects a webinar that is not bound to the submitted form", async () => {
    db.live.findFirst.mockResolvedValue(null);

    const response = await POST(jsonRequest({
      formId: "form-1", liveId: "live-a", payload: { name: "Lead", email: "lead@example.test" },
    }));

    expect(response.status).toBe(404);
    expect(db.live.findFirst).toHaveBeenCalledWith({
      where: { id: "live-a", vendorId: "vendor-1", formId: "form-1" },
      select: { id: true },
    });
    expect(db.formSubmission.create).not.toHaveBeenCalled();
  });
});

describe("native form submission redirects", () => {
  it("keeps a root-relative redirect on the request origin", async () => {
    const response = await POST(nativeFormRequest("/forms/summer?source=landing"));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://app.example.test/forms/summer?source=landing&submitted=1",
    );
  });

  it.each(["//attacker.example.test/collect", "/\\attacker.example.test/collect"])(
    "does not redirect a cross-origin relative-looking value (%s)",
    async (redirectTo) => {
      const response = await POST(nativeFormRequest(redirectTo));

      expect(response.status).toBe(200);
      expect(response.headers.get("location")).toBeNull();
      await expect(response.json()).resolves.toEqual({ ok: true });
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
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    }));

    expect(response.status).toBe(400);
    expect(db.registrationForm.findUnique).not.toHaveBeenCalled();
    expect(db.formSubmission.create).not.toHaveBeenCalled();
  });
});
