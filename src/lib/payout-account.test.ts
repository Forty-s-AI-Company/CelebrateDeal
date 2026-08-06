import { describe, expect, it } from "vitest";
import {
  isEligiblePayoutAccount,
  PayoutAccountSelectionError,
  selectPayoutAccount,
} from "./payout-account";

const activePlatformLegacyAccount = {
  id: "account-platform",
  mode: "platform",
  status: "active",
  bankAccountEncrypted: null,
  bankAccountLegacyName: "測試商家",
  bankCodeLegacy: "700",
  bankAccountLegacyNumber: "synthetic-account-number",
};

describe("payout account eligibility", () => {
  it("accepts a complete active platform legacy account", () => {
    expect(isEligiblePayoutAccount(activePlatformLegacyAccount)).toBe(true);
    expect(selectPayoutAccount([activePlatformLegacyAccount])).toBe(activePlatformLegacyAccount);
  });

  it("accepts an encrypted active platform account without legacy fields", () => {
    const encrypted = {
      ...activePlatformLegacyAccount,
      bankAccountEncrypted: "v2.synthetic.envelope",
      bankAccountLegacyName: null,
      bankCodeLegacy: null,
      bankAccountLegacyNumber: null,
    };

    expect(isEligiblePayoutAccount(encrypted)).toBe(true);
    expect(selectPayoutAccount([encrypted])).toBe(encrypted);
  });

  it.each([
    ["BYO account", { ...activePlatformLegacyAccount, mode: "byo" }],
    ["inactive account", { ...activePlatformLegacyAccount, status: "inactive" }],
    ["missing account name", { ...activePlatformLegacyAccount, bankAccountLegacyName: "" }],
    ["missing bank code", { ...activePlatformLegacyAccount, bankCodeLegacy: null }],
    ["missing account number", { ...activePlatformLegacyAccount, bankAccountLegacyNumber: " " }],
  ])("rejects an ineligible %s", (_label, account) => {
    expect(isEligiblePayoutAccount(account)).toBe(false);
    expect(() => selectPayoutAccount([account])).toThrow(PayoutAccountSelectionError);
  });

  it("fails closed when no eligible account exists", () => {
    expect(() => selectPayoutAccount([])).toThrow(PayoutAccountSelectionError);
  });

  it("fails closed when multiple eligible platform accounts are ambiguous", () => {
    expect(() => selectPayoutAccount([
      activePlatformLegacyAccount,
      { ...activePlatformLegacyAccount, id: "account-platform-2" },
    ])).toThrow(PayoutAccountSelectionError);
  });

  it("fails closed when one complete and one incomplete account are both active platform accounts", () => {
    expect(() => selectPayoutAccount([
      activePlatformLegacyAccount,
      {
        ...activePlatformLegacyAccount,
        id: "account-platform-incomplete",
        bankAccountLegacyNumber: null,
      },
    ])).toThrow(PayoutAccountSelectionError);
  });
});
