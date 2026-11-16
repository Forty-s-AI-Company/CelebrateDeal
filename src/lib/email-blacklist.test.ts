import { describe, expect, it, vi } from "vitest";

import { isEmailBlacklistedForVendor } from "@/lib/email-blacklist";

function reader(row: { id: string } | null) {
  return { blacklist: { findFirst: vi.fn(async () => row) } };
}

describe("isEmailBlacklistedForVendor", () => {
  it("looks up the normalized address among this vendor's active email blocks only", async () => {
    const db = reader({ id: "blacklist-1" });
    await expect(isEmailBlacklistedForVendor(db, "vendor-1", "  Learner@Example.TEST ")).resolves.toBe(true);
    expect(db.blacklist.findFirst).toHaveBeenCalledExactlyOnceWith({
      where: { vendorId: "vendor-1", identifierType: "email", identifier: "learner@example.test", isActive: true, unblockedAt: null },
      select: { id: true },
    });
  });

  it("is false when no active block matches", async () => {
    await expect(isEmailBlacklistedForVendor(reader(null), "vendor-1", "learner@example.test")).resolves.toBe(false);
  });

  it("never queries without a vendor or with an address the list could not hold", async () => {
    const db = reader({ id: "blacklist-1" });
    await expect(isEmailBlacklistedForVendor(db, "", "learner@example.test")).resolves.toBe(false);
    await expect(isEmailBlacklistedForVendor(db, "vendor-1", "not-an-email")).resolves.toBe(false);
    expect(db.blacklist.findFirst).not.toHaveBeenCalled();
  });
});
