import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ getDb: () => { throw new Error("tests pass an explicit db"); } }));

import {
  isMerchantRegistrationInviteRevoked,
  maskedMerchantInviteEmail,
  merchantInviteEmailHash,
  recentMerchantInvitations,
} from "@/lib/merchant-registration-invite-records";

beforeEach(() => vi.stubEnv("CSRF_SECRET", "synthetic-invite-records-secret-at-least-32b"));
afterEach(() => vi.unstubAllEnvs());

describe("invite audit identifiers", () => {
  it("hashes the normalised email with a purpose key and masks it for display", () => {
    const hash = merchantInviteEmailHash("Owner@Example.test ");
    expect(hash).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(merchantInviteEmailHash("owner@example.test")).toBe(hash);
    expect(merchantInviteEmailHash("other@example.test")).not.toBe(hash);
    vi.stubEnv("CSRF_SECRET", "another-synthetic-secret-also-32-bytes-long");
    expect(merchantInviteEmailHash("owner@example.test")).not.toBe(hash);
    expect(maskedMerchantInviteEmail(" Owner@Example.test")).toBe("o***@example.test");
  });
});

describe("isMerchantRegistrationInviteRevoked", () => {
  it("uses one (targetType, targetId) lookup scoped to platform revocations", async () => {
    const findFirst = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "a" });
    const db = { auditLog: { findFirst } } as never;
    await expect(isMerchantRegistrationInviteRevoked("jti-1", db)).resolves.toBe(false);
    await expect(isMerchantRegistrationInviteRevoked("jti-1", db)).resolves.toBe(true);
    expect(findFirst).toHaveBeenCalledWith({
      where: { targetType: "MerchantRegistrationInvite", targetId: "jti-1", action: "merchant_registration_invite_revoked", vendorId: null },
      select: { id: true },
    });
  });
});

type FindManyArgs = { where: { action: string; createdAt?: { gte?: Date; lt?: Date } }; take?: number };

describe("recentMerchantInvitations", () => {
  const now = new Date("2026-10-25T00:00:00.000Z");
  const windowStart = new Date("2026-10-11T00:00:00.000Z"); // now − 14 days
  const created = { action: "merchant_registration_invite_created", vendorId: null, targetType: "MerchantRegistrationInvite" };

  it("returns nothing without querying status when no invitation exists", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    await expect(recentMerchantInvitations(now, { auditLog: { findMany } } as never)).resolves.toEqual({ items: [], activeTruncated: false });
    expect(findMany).toHaveBeenCalledTimes(2);
  });

  it("lists every invitation from the last TTL plus older history, with status by jti", async () => {
    const findMany = vi.fn(async ({ where }: FindManyArgs) => {
      if (where.action === "merchant_registration_invite_created" && where.createdAt?.gte) {
        return [
          { targetId: "jti-registered", createdAt: new Date("2026-10-24T00:00:00.000Z"), after: { maskedEmail: "a***@example.test", expiresAt: "2026-11-07T00:00:00.000Z" } },
          { targetId: "jti-revoked", createdAt: new Date("2026-10-23T00:00:00.000Z"), after: { maskedEmail: "b***@example.test", expiresAt: "2026-11-06T00:00:00.000Z" } },
          { targetId: "jti-pending", createdAt: new Date("2026-10-22T00:00:00.000Z"), after: ["unexpected"] },
          { targetId: null, createdAt: new Date("2026-10-22T00:00:00.000Z"), after: {} },
        ];
      }
      if (where.action === "merchant_registration_invite_created") {
        return [{ targetId: "jti-expired", createdAt: new Date("2026-10-01T00:00:00.000Z"), after: { maskedEmail: "c***@example.test", expiresAt: "2026-10-15T00:00:00.000Z" } }];
      }
      if (where.action === "merchant_registration_invite_revoked") return [{ targetId: "jti-revoked" }, { targetId: "jti-registered" }];
      return [{ after: { registrationInvite: { jti: "jti-registered" } } }, { after: { policyConsent: {} } }, { after: null }];
    });
    const { items, activeTruncated } = await recentMerchantInvitations(now, { auditLog: { findMany } } as never);
    expect(activeTruncated).toBe(false);
    expect(items.map((row) => [row.jti, row.status, row.maskedEmail])).toEqual([
      ["jti-registered", "registered", "a***@example.test"],
      ["jti-revoked", "revoked", "b***@example.test"],
      ["jti-pending", "pending", null],
      ["jti-expired", "expired", "c***@example.test"],
    ]);
    const select = { targetId: true, createdAt: true, after: true };
    expect(findMany).toHaveBeenCalledWith({ where: { ...created, createdAt: { gte: windowStart } }, orderBy: { createdAt: "desc" }, take: 501, select });
    expect(findMany).toHaveBeenCalledWith({ where: { ...created, createdAt: { lt: windowStart } }, orderBy: { createdAt: "desc" }, take: 30, select });
    const jtis = ["jti-registered", "jti-revoked", "jti-pending", "jti-expired"];
    expect(findMany).toHaveBeenCalledWith({
      where: { targetType: "MerchantRegistrationInvite", targetId: { in: jtis }, action: "merchant_registration_invite_revoked", vendorId: null },
      select: { targetId: true },
    });
    // The registration scan is bounded to registrations after the oldest listed invitation.
    expect(findMany).toHaveBeenCalledWith({
      where: {
        action: "registration_completed",
        createdAt: { gte: new Date("2026-10-01T00:00:00.000Z") },
        OR: jtis.map((jti) => ({ after: { path: ["registrationInvite", "jti"], equals: jti } })),
      },
      select: { after: true },
    });
  });

  it("caps the possibly-valid list and says so", async () => {
    const active = Array.from({ length: 501 }, (_, index) => ({
      targetId: `jti-active-${String(index).padStart(6, "0")}`,
      createdAt: new Date(now.getTime() - index * 60_000),
      after: { maskedEmail: "x***@example.test", expiresAt: "2026-11-08T00:00:00.000Z" },
    }));
    const findMany = vi.fn(async ({ where }: FindManyArgs) => where.action === "merchant_registration_invite_created" && where.createdAt?.gte ? active : []);
    const { items, activeTruncated } = await recentMerchantInvitations(now, { auditLog: { findMany } } as never);
    expect(activeTruncated).toBe(true);
    expect(items).toHaveLength(500);
    expect(items.every((row) => row.status === "pending")).toBe(true);
  });
});
