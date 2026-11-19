import { describe, expect, it } from "vitest";
import { isLineActionUrl } from "@/lib/line-action-url";
import { buildAutomationLineMessage } from "@/lib/line-notification";

describe("isLineActionUrl (A2-09)", () => {
  it("accepts only absolute HTTPS URLs, like the LINE button builder", () => {
    for (const url of ["https://app.example.test/api/automation/vouchers/redeem?token=x", "https://meet.example.test/room"]) {
      expect(isLineActionUrl(url)).toBe(true);
      expect(() => buildAutomationLineMessage({ message: "m", buttonLabel: "b", buttonUrl: url })).not.toThrow();
    }
    for (const url of ["http://localhost:31023/api/automation/vouchers/redeem?token=x", "http://127.0.0.1:3000/live/x", "", "{{voucher_url}}", "/relative", "javascript:alert(1)", "not a url"]) {
      expect(isLineActionUrl(url)).toBe(false);
      expect(() => buildAutomationLineMessage({ message: "m", buttonLabel: "b", buttonUrl: url || "x" })).toThrow();
    }
  });
});
