import { describe, expect, it, vi } from "vitest";
import { consultantDayRange, listTodayConsultations, safeTelHref } from "./mobile-consultation-cockpit";

describe("mobile consultant cockpit", () => {
  it("queries only the tenant's current Taipei day and sorts by time", async () => {
    const findMany = vi.fn().mockResolvedValue([
      { id: "late", startTime: new Date("2026-09-09T07:00:00Z"), endTime: new Date(), status: "scheduled", clientName: "乙", clientPhone: "+886912345678", customerKeyHash: "hash", meetingUrl: "javascript:alert(1)", event: { title: "諮詢" } },
      { id: "early", startTime: new Date("2026-09-09T02:00:00Z"), endTime: new Date(), status: "scheduled", clientName: "甲", clientPhone: "+886923456789", customerKeyHash: "hash", meetingUrl: "https://meet.example.test/room", event: { title: "諮詢" } },
    ]);
    const result = await listTodayConsultations({ consultationBooking: { findMany } }, "vendor-1", new Date("2026-09-09T04:00:00Z"));
    expect(result.map((item) => item.id)).toEqual(["early", "late"]);
    expect(result[1]?.meetingUrl).toBeNull();
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ vendorId: "vendor-1" }), take: 100 }));
    expect(consultantDayRange(new Date("2026-09-09T04:00:00Z"))).toEqual({ from: new Date("2026-09-08T16:00:00Z"), to: new Date("2026-09-09T16:00:00Z") });
  });

  it("allows only normalized E.164 telephone links", () => {
    expect(safeTelHref("+886 912-345-678")).toBe("tel:+886912345678");
    expect(safeTelHref("javascript:alert(1)")).toBeNull();
    expect(safeTelHref("0912345678")).toBeNull();
  });
});
