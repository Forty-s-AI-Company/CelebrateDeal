import { describe, expect, it, vi } from "vitest";
import {
  automationActionsSendLine,
  automationRuleIncludesLinePush,
  automationRuleSendsLine,
  mayWriteAutomationActions,
  storedAutomationRuleSendsLine,
  voucherActionSendsLine,
  withVoucherLineNotification,
} from "@/lib/automation-line-push-policy";

// Owner decisions 2026-11-14 (custom LINE push) and 2026-11-15 (a voucher's
// fixed-text LINE notification): what counts as "sends LINE" and how writers
// set a voucher's flag.
const VOUCHER = { type: "issue_repurchase_voucher", productId: "p1", discountType: "fixed", discountValue: 100, expiresInDays: 7 };
const LINE = { type: "line_push", message: "老闆的推播" };
const TAG = { type: "add_customer_tag", tag: "VIP" };

describe("voucher LINE notification flag", () => {
  it.each([
    ["true", { ...VOUCHER, lineNotification: true }, true],
    ["missing (stored before the flag)", VOUCHER, true],
    ["false", { ...VOUCHER, lineNotification: false }, false],
  ])("treats a voucher whose flag is %s as sending LINE: %s", (_label, voucher, sends) => {
    expect(voucherActionSendsLine(voucher)).toBe(sends);
    expect(automationActionsSendLine([TAG, voucher])).toBe(sends);
    // Immediate actions or any step, active or not.
    expect(automationRuleSendsLine({ actions: [voucher] })).toBe(sends);
    expect(automationRuleSendsLine({ actions: [TAG], steps: [{ actions: [TAG] }, { actions: [voucher] }] })).toBe(sends);
    // Only the owner may save actions that send LINE.
    expect(mayWriteAutomationActions("admin", [voucher])).toBe(!sends);
    expect(mayWriteAutomationActions("owner", [voucher])).toBe(true);
  });

  it("only counts a voucher action, and keeps a LINE push sending whatever the voucher's flag", () => {
    expect(voucherActionSendsLine({ ...TAG, lineNotification: true })).toBe(false);
    expect(voucherActionSendsLine(null)).toBe(false);
    expect(voucherActionSendsLine("issue_repurchase_voucher")).toBe(false);
    expect(automationActionsSendLine([{ ...VOUCHER, lineNotification: false }, LINE])).toBe(true);
    expect(automationActionsSendLine([TAG])).toBe(false);
    expect(automationActionsSendLine("not a list")).toBe(false);
    expect(automationRuleSendsLine({ actions: [TAG], steps: null })).toBe(false);
    // The narrower LINE-push check is unchanged: a voucher is not a LINE push.
    expect(automationRuleIncludesLinePush({ actions: [VOUCHER] })).toBe(false);
    expect(automationRuleIncludesLinePush({ actions: [TAG], steps: [{ actions: [LINE] }] })).toBe(true);
  });

  it("forces every voucher of a non-owner off, whatever was asked, and leaves other actions alone", () => {
    expect(withVoucherLineNotification([{ ...VOUCHER, lineNotification: true }, VOUCHER, TAG], false)).toEqual([
      { ...VOUCHER, lineNotification: false },
      { ...VOUCHER, lineNotification: false },
      TAG,
    ]);
    // After the normalization an admin's voucher rule may be saved.
    expect(mayWriteAutomationActions("admin", withVoucherLineNotification([VOUCHER, TAG], false))).toBe(true);
    expect(mayWriteAutomationActions("admin", withVoucherLineNotification([VOUCHER, LINE], false))).toBe(false);
  });

  it("stores the owner's choice explicitly: on by default, off when asked", () => {
    expect(withVoucherLineNotification([VOUCHER], true)).toEqual([{ ...VOUCHER, lineNotification: true }]);
    expect(withVoucherLineNotification([{ ...VOUCHER, lineNotification: true }], true)).toEqual([{ ...VOUCHER, lineNotification: true }]);
    expect(withVoucherLineNotification([{ ...VOUCHER, lineNotification: false }], true)).toEqual([{ ...VOUCHER, lineNotification: false }]);
  });

  it("reads the stored rule and its steps bound to the vendor, null when it is not the vendor's", async () => {
    const findFirst = vi.fn().mockResolvedValueOnce({ actions: [TAG], steps: [{ actions: [VOUCHER] }] }).mockResolvedValueOnce(null);
    const db = { automationRule: { findFirst } };
    await expect(storedAutomationRuleSendsLine(db as never, { vendorId: "v1", ruleId: "r1" })).resolves.toBe(true);
    await expect(storedAutomationRuleSendsLine(db as never, { vendorId: "v1", ruleId: "other", funnelPageId: "page-1", trigger: "form_registered" })).resolves.toBeNull();
    expect(findFirst).toHaveBeenNthCalledWith(1, {
      where: { id: "r1", vendorId: "v1" },
      select: { actions: true, steps: { where: { vendorId: "v1" }, select: { actions: true } } },
    });
    expect(findFirst).toHaveBeenNthCalledWith(2, expect.objectContaining({ where: { id: "other", vendorId: "v1", funnelPageId: "page-1", trigger: "form_registered" } }));
  });
});
