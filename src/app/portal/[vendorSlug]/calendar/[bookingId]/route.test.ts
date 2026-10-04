import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), booking: vi.fn() }));
vi.mock("@/lib/student-portal-auth", () => ({ requireStudentPortalSession: mocks.session }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ consultationBooking: { findFirst: mocks.booking } }) }));
import { GET } from "./route";

beforeEach(() => { vi.clearAllMocks(); mocks.session.mockResolvedValue({ session: { vendorId: "vendor-1", customerKeyHash: "hash" } }); mocks.booking.mockResolvedValue({ id: "booking-1", startTime: new Date("2026-09-20T02:00:00Z"), endTime: new Date("2026-09-20T03:00:00Z"), meetingUrl: "https://meet.example.test/room", event: { title: "策略諮詢", description: "準備問題" } }); });
describe("student portal calendar route", () => {
  it("scopes the booking to tenant and student then emits a private ICS file", async () => {
    const response = await GET(new Request("https://app.example.test"), { params: Promise.resolve({ vendorSlug: "teacher", bookingId: "booking-1" }) });
    expect(mocks.booking).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "booking-1", vendorId: "vendor-1", customerKeyHash: "hash" } }));
    expect(response.headers.get("content-type")).toContain("text/calendar");
    expect(await response.text()).toContain("BEGIN:VEVENT");
  });
});
