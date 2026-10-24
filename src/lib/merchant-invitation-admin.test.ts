import { describe, expect, it } from "vitest";
import { formatInvitationTime } from "@/lib/merchant-invitation-admin";

describe("formatInvitationTime", () => {
  it("formats in Taiwan time across the date line", () => {
    expect(formatInvitationTime(new Date("2026-10-24T16:05:00.000Z"))).toBe("2026/10/25 00:05");
    expect(formatInvitationTime("2026-12-31T23:59:00.000Z")).toBe("2027/01/01 07:59");
  });

  it("shows a dash for an unreadable value", () => {
    expect(formatInvitationTime("not a date")).toBe("—");
    expect(formatInvitationTime(new Date(Number.NaN))).toBe("—");
  });
});
