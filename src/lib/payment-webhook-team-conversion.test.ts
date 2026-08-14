import { beforeEach, describe, expect, it, vi } from "vitest";
import { reconcileTeamConversionAttribution } from "@/lib/payment-webhooks";

const db = {
  teamLeadAttribution: { findFirst: vi.fn() },
  teamClickAttribution: { findFirst: vi.fn() },
  teamConversionAttribution: { findUnique: vi.fn(), create: vi.fn() },
};

const snapshot = {
  id: "source-1",
  teamId: "team-1",
  pageId: "page-b",
  leaderMembershipId: "member-a",
  promoterMembershipId: "member-b",
  contentOwnerMembershipId: "member-a",
  seminarOwnerMembershipId: "member-a",
  source: "EXISTING_OWNER" as const,
  referralCode: null,
};

function reconcile(overrides: Partial<Parameters<typeof reconcileTeamConversionAttribution>[1]> = {}) {
  return reconcileTeamConversionAttribution(
    db as unknown as Parameters<typeof reconcileTeamConversionAttribution>[0],
    {
      vendorId: "vendor-1",
      paymentTransactionId: "payment-1",
      formSubmissionId: null,
      affiliateClickId: null,
      ...overrides,
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  db.teamLeadAttribution.findFirst.mockResolvedValue(null);
  db.teamClickAttribution.findFirst.mockResolvedValue(null);
  db.teamConversionAttribution.findUnique.mockResolvedValue(null);
  db.teamConversionAttribution.create.mockImplementation(async ({ data }) => ({ id: "conversion-1", ...data }));
});

describe("reconcileTeamConversionAttribution", () => {
  it("creates a conversion from a server-owned team click when no lead exists", async () => {
    db.teamClickAttribution.findFirst.mockResolvedValue(snapshot);

    await reconcile({ affiliateClickId: "click-1" });

    expect(db.teamClickAttribution.findFirst).toHaveBeenCalledWith({
      where: { vendorId: "vendor-1", affiliateClickId: "click-1" },
      select: expect.objectContaining({ promoterMembershipId: true, pageId: true }),
    });
    expect(db.teamConversionAttribution.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        vendorId: "vendor-1",
        paymentTransactionId: "payment-1",
        leadAttributionId: null,
        pageId: "page-b",
        leaderMembershipId: "member-a",
        promoterMembershipId: "member-b",
      }),
    });
  });

  it("prefers a verified lead snapshot when lead and click identities are both present", async () => {
    db.teamLeadAttribution.findFirst.mockResolvedValue({ ...snapshot, id: "lead-1", referralCode: "B-CODE" });

    await reconcile({ formSubmissionId: "submission-1", affiliateClickId: "click-1" });

    expect(db.teamLeadAttribution.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { vendorId: "vendor-1", formSubmissionId: "submission-1" },
    }));
    expect(db.teamClickAttribution.findFirst).not.toHaveBeenCalled();
    expect(db.teamConversionAttribution.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ leadAttributionId: "lead-1", referralCode: "B-CODE" }),
    });
  });

  it("is idempotent for the same immutable snapshot and rejects an identity conflict", async () => {
    db.teamClickAttribution.findFirst.mockResolvedValue(snapshot);
    const existing = {
      id: "conversion-1",
      vendorId: "vendor-1",
      paymentTransactionId: "payment-1",
      teamId: "team-1",
      leadAttributionId: null,
      pageId: "page-b",
      leaderMembershipId: "member-a",
      promoterMembershipId: "member-b",
      contentOwnerMembershipId: "member-a",
      seminarOwnerMembershipId: "member-a",
      source: "EXISTING_OWNER",
      referralCode: null,
    };
    db.teamConversionAttribution.findUnique.mockResolvedValue(existing);

    await expect(reconcile({ affiliateClickId: "click-1" })).resolves.toMatchObject({ id: "conversion-1" });
    expect(db.teamConversionAttribution.create).not.toHaveBeenCalled();

    db.teamConversionAttribution.findUnique.mockResolvedValueOnce({ ...existing, promoterMembershipId: "member-c" });
    await expect(reconcile({ affiliateClickId: "click-1" })).rejects.toThrow("不可變身分不一致");
  });

  it("does not create a conversion without a same-vendor server attribution snapshot", async () => {
    await expect(reconcile({ affiliateClickId: "unknown-click" })).resolves.toBeNull();
    expect(db.teamConversionAttribution.findUnique).not.toHaveBeenCalled();
    expect(db.teamConversionAttribution.create).not.toHaveBeenCalled();
  });
});
