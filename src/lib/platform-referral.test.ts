import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  capturePlatformReferralAttribution,
  PLATFORM_REFERRAL_TTL_MS,
  recordPlatformReferralClick,
} from "@/lib/platform-referral";

const db = {
  platformReferralCode: { findFirst: vi.fn() },
  platformReferralClick: { create: vi.fn(), findUnique: vi.fn() },
  platformReferralAttribution: { upsert: vi.fn() },
};

beforeEach(() => {
  vi.clearAllMocks();
  db.platformReferralCode.findFirst.mockResolvedValue({ id: "ref-code-1" });
  db.platformReferralClick.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "click-1", ...data }));
  db.platformReferralAttribution.upsert.mockResolvedValue({ id: "attribution-1" });
});

describe("platform referral attribution boundary", () => {
  it("records a click only for an active platform code with bounded expiry", async () => {
    const now = new Date("2026-08-07T00:00:00.000Z");
    const click = await recordPlatformReferralClick(db as never, {
      code: "EDEN10",
      visitorId: "visitor-1",
      landingPath: "/billing/plans",
      now,
    });

    expect(click).toMatchObject({ id: "click-1", referralCodeId: "ref-code-1" });
    expect(db.platformReferralCode.findFirst).toHaveBeenCalledWith({
      where: { code: "EDEN10", isActive: true },
      select: { id: true },
    });
    expect(db.platformReferralClick.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        visitorId: "visitor-1",
        landingPath: "/billing/plans",
        expiresAt: new Date(now.getTime() + PLATFORM_REFERRAL_TTL_MS),
      }),
    });
  });

  it("captures an immutable code and rate snapshot only before expiry", async () => {
    const capturedAt = new Date("2026-08-07T00:00:00.000Z");
    db.platformReferralClick.findUnique.mockResolvedValue({
      id: "click-1",
      expiresAt: new Date("2026-08-08T00:00:00.000Z"),
      referralCode: {
        id: "ref-code-1",
        code: "EDEN10",
        ownerUserId: "user-referrer",
        commissionRateBps: 1_000,
        isActive: true,
      },
    });

    await capturePlatformReferralAttribution(db as never, {
      clickId: "click-1",
      subscriptionId: "subscription-1",
      capturedAt,
    });

    expect(db.platformReferralAttribution.upsert).toHaveBeenCalledWith({
      where: { subscriptionId: "subscription-1" },
      create: {
        referralCodeId: "ref-code-1",
        clickId: "click-1",
        subscriptionId: "subscription-1",
        ownerUserId: "user-referrer",
        codeSnapshot: "EDEN10",
        commissionRateBpsSnapshot: 1_000,
      },
      update: {},
    });
  });

  it("fails closed for missing, expired or inactive attribution", async () => {
    await expect(capturePlatformReferralAttribution(db as never, { clickId: null, subscriptionId: "subscription-1" })).resolves.toBeNull();

    db.platformReferralClick.findUnique.mockResolvedValueOnce({
      id: "click-1",
      expiresAt: new Date("2026-08-06T00:00:00.000Z"),
      referralCode: { id: "ref-code-1", code: "EDEN10", ownerUserId: "user-referrer", commissionRateBps: 1_000, isActive: true },
    }).mockResolvedValueOnce({
      id: "click-2",
      expiresAt: new Date("2026-08-08T00:00:00.000Z"),
      referralCode: { id: "ref-code-1", code: "EDEN10", ownerUserId: "user-referrer", commissionRateBps: 1_000, isActive: false },
    });

    await expect(capturePlatformReferralAttribution(db as never, { clickId: "click-1", subscriptionId: "subscription-1", capturedAt: new Date("2026-08-07T00:00:00.000Z") })).resolves.toBeNull();
    await expect(capturePlatformReferralAttribution(db as never, { clickId: "click-2", subscriptionId: "subscription-2", capturedAt: new Date("2026-08-07T00:00:00.000Z") })).resolves.toBeNull();
    expect(db.platformReferralAttribution.upsert).not.toHaveBeenCalled();
  });

  it("fails closed for an invalid future commission rate snapshot", async () => {
    db.platformReferralClick.findUnique.mockResolvedValue({
      id: "click-invalid-rate",
      expiresAt: new Date("2026-08-08T00:00:00.000Z"),
      referralCode: { id: "ref-code-1", code: "EDEN10", ownerUserId: "user-referrer", commissionRateBps: 10_001, isActive: true },
    });

    await expect(capturePlatformReferralAttribution(db as never, {
      clickId: "click-invalid-rate",
      subscriptionId: "subscription-invalid-rate",
      capturedAt: new Date("2026-08-07T00:00:00.000Z"),
    })).resolves.toBeNull();
    expect(db.platformReferralAttribution.upsert).not.toHaveBeenCalled();
  });
});
