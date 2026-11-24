import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  BETA_AGREEMENT_CONTEXT,
  betaAgreementAppliesTo,
  betaAgreementGatePath,
  betaAgreementReturnPath,
  canAcceptBetaAgreement,
  betaAgreementTextSha256,
  isCurrentBetaAgreementVersion,
  recordBetaAgreementAcceptance,
} from "@/lib/beta-agreement";
import { BETA_AGREEMENT_VERSION, betaAgreement } from "@/lib/beta-agreement-content";

describe("封測合作協議 content", () => {
  it("has a database-safe version and the owner's 2026-11-20 and 2026-11-24 decisions", () => {
    expect(BETA_AGREEMENT_VERSION).toBe("beta-2026.11.24");
    // UserPolicyConsent_version_check
    expect(BETA_AGREEMENT_VERSION).toMatch(/^[0-9A-Za-z._-]{1,32}$/u);
    // Written into the module, not read from publicSupportContact (review m-1).
    expect(betaAgreement.operator).toEqual({ name: "Carry Digital Nomad 凱瑞數位", email: "a88221144@gmail.com" });
    const item = (section: number, index: number) => betaAgreement.sections.find((entry) => entry.number === section)!.items[index - 1];
    expect(item(1, 1)).toBe("封測期間自乙方同意本協議之日起，至本平台正式上線為止；甲方得以 Email 通知提前結束或調整。");
    expect(item(8, 2)).toBe("甲方依本協議對乙方負擔的賠償總額，以新台幣 3,000 元為上限。");
    expect(item(11, 3)).toBe("本協議以乙方在本平台勾選同意的方式簽署，本平台記錄同意的帳號、商家、協議版本與時間。");
    expect(item(11, 1)).toBe("本協議以中華民國法律為準據法。如有爭議，雙方同意以臺灣臺中地方法院為第一審管轄法院。");
    expect(betaAgreement.sections.map((section) => section.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it("binds the full text to its version: changing a word without a new version fails here", () => {
    // When the text changes on purpose: give it a new BETA_AGREEMENT_VERSION (every
    // merchant accepts again) and record the new pair below in the same commit.
    expect({ version: BETA_AGREEMENT_VERSION, sha256: betaAgreementTextSha256() }).toEqual({
      version: "beta-2026.11.24",
      sha256: "4825bbfef0f10a82775afb013035d2c6ad23b8ffca64234df32fb75f1bad4911",
    });
  });

  it("leaves no unfilled blank or drafting note in the text", () => {
    const text = JSON.stringify(betaAgreement);
    expect(text).not.toMatch(/［|］|使用說明|寄給商家|Email 回覆「同意」/u);
  });
});

describe("version and role checks", () => {
  it("accepts only the server's current version", () => {
    expect(isCurrentBetaAgreementVersion(BETA_AGREEMENT_VERSION)).toBe(true);
    for (const value of ["beta-2026.11.19", ` ${BETA_AGREEMENT_VERSION}`, "", null, undefined, 20261120]) {
      expect(isCurrentBetaAgreementVersion(value)).toBe(false);
    }
  });

  it("lets only an active owner accept for the merchant", () => {
    expect(canAcceptBetaAgreement({ role: "owner", status: "active" })).toBe(true);
    for (const member of [{ role: "owner", status: "inactive" }, { role: "admin", status: "active" }, { role: "accountant", status: "active" }, { role: "support", status: "active" }, { role: "partner", status: "active" }, null, undefined]) {
      expect(canAcceptBetaAgreement(member)).toBe(false);
    }
  });

  it("never gates a platform administrator", () => {
    expect(betaAgreementAppliesTo({ isPlatformAdmin: true })).toBe(false);
    expect(betaAgreementAppliesTo({ isPlatformAdmin: false })).toBe(true);
  });
});

describe("return paths", () => {
  it("keeps only safe internal paths and never loops back to the gate", () => {
    expect(betaAgreementReturnPath("/welcome")).toBe("/welcome");
    expect(betaAgreementReturnPath("/orders?status=paid")).toBe("/orders?status=paid");
    for (const value of ["https://evil.example", "//evil.example", "/beta-agreement", "/beta-agreement?next=%2Forders", null, 42]) {
      expect(betaAgreementReturnPath(value)).toBe("/dashboard");
    }
    expect(betaAgreementGatePath()).toBe("/beta-agreement");
    expect(betaAgreementGatePath("/dashboard")).toBe("/beta-agreement");
    expect(betaAgreementGatePath("/welcome")).toBe("/beta-agreement?next=%2Fwelcome");
    expect(betaAgreementGatePath("https://evil.example")).toBe("/beta-agreement");
  });
});

describe("recordBetaAgreementAcceptance", () => {
  function fakeDb({ owner = true, inserted = 1 }: { owner?: boolean; inserted?: number } = {}) {
    const tx = {
      vendorMember: { findFirst: vi.fn(async () => (owner ? { id: "member-1" } : null)) },
      userPolicyConsent: { createMany: vi.fn(async () => ({ count: inserted })) },
      auditLog: { create: vi.fn(async () => ({ id: "audit-1" })) },
    };
    const db = { $transaction: vi.fn(async (run: (client: typeof tx) => Promise<unknown>) => run(tx)) };
    return { db: db as unknown as PrismaClient, tx };
  }
  const input = { userId: "user-1", vendorId: "vendor-1", vendorName: "合成商家" };

  it("re-checks the owner, writes the current version and audits it", async () => {
    const { db, tx } = fakeDb();
    await expect(recordBetaAgreementAcceptance(db, input)).resolves.toBe("recorded");
    expect(tx.vendorMember.findFirst).toHaveBeenCalledWith({ where: { vendorId: "vendor-1", userId: "user-1", role: "owner", status: "active" }, select: { id: true } });
    expect(tx.userPolicyConsent.createMany).toHaveBeenCalledWith({
      data: [{ userId: "user-1", vendorId: "vendor-1", context: BETA_AGREEMENT_CONTEXT, agreementVersion: BETA_AGREEMENT_VERSION }],
      skipDuplicates: true,
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      vendorId: "vendor-1", actorId: "user-1", action: "beta_agreement_accepted", targetType: "Vendor", targetId: "vendor-1",
      after: { agreementVersion: BETA_AGREEMENT_VERSION, agreementSha256: betaAgreementTextSha256(), vendorName: "合成商家" },
    }) });
  });

  it("is idempotent: a repeated acceptance writes no second row or audit", async () => {
    const { db, tx } = fakeDb({ inserted: 0 });
    await expect(recordBetaAgreementAcceptance(db, input)).resolves.toBe("already_recorded");
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it("writes nothing for a user who is not an active owner of the vendor", async () => {
    const { db, tx } = fakeDb({ owner: false });
    await expect(recordBetaAgreementAcceptance(db, input)).resolves.toBe("not_owner");
    expect(tx.userPolicyConsent.createMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});
