import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ boundary: vi.fn(), readJson: vi.fn(), csrf: vi.fn(), token: vi.fn(), session: vi.fn(), list: vi.fn(), confirm: vi.fn(), db: {} }));
vi.mock("@/lib/api-security", () => ({ requireSameOriginRequest: mocks.boundary, readJsonBody: mocks.readJson }));
vi.mock("@/lib/csrf", () => ({ verifyCsrfToken: mocks.csrf, getCsrfToken: mocks.token }));
vi.mock("@/lib/student-portal-auth", () => ({ requireStudentPortalSession: mocks.session }));
vi.mock("@/lib/learner-consultation-reminders", async original => ({ ...await original<typeof import("@/lib/learner-consultation-reminders")>(), listLearnerConsultationReminders: mocks.list, confirmLearnerConsultationReminder: mocks.confirm }));
vi.mock("@/lib/db", () => ({ getDb: () => mocks.db }));
import { GET, POST } from "./route";
const identity = { vendorId: "vendor-1", customerKeyHash: "a".repeat(43) };
const context = { params: Promise.resolve({ vendorSlug: "academy", courseId: "course-1" }) };
const body = { bookingId: "booking-1", expectedStartTime: "2026-10-08T08:00:00.000Z" };
const request = (suffix = "") => new Request(`https://app.example.test/portal/academy/learn/course-1/notifications/reminders${suffix}`, { method: "POST", headers: { "x-csrf-token": "synthetic" } });
beforeEach(() => {
  vi.clearAllMocks(); mocks.boundary.mockReturnValue(null); mocks.csrf.mockResolvedValue(true); mocks.readJson.mockResolvedValue(body);
  mocks.session.mockResolvedValue({ session: identity }); mocks.token.mockResolvedValue("synthetic-csrf"); mocks.list.mockResolvedValue({ bookings: [], nextAfter: null });
  mocks.confirm.mockResolvedValue({ status: "scheduled", availableAt: "2026-10-08T07:00:00.000Z" });
});
it("same-origin refusal reaches neither session nor confirmation", async () => {
  mocks.boundary.mockReturnValue(new Response(null, { status: 403 }));
  expect((await POST(request(), context)).status).toBe(403); expect((await GET(request(), context)).status).toBe(403);
  expect(mocks.session).not.toHaveBeenCalled(); expect(mocks.confirm).not.toHaveBeenCalled();
});
it("CSRF refusal precedes authenticated or database work", async () => {
  mocks.csrf.mockResolvedValue(false); expect((await POST(request(), context)).status).toBe(403); expect(mocks.session).not.toHaveBeenCalled(); expect(mocks.confirm).not.toHaveBeenCalled();
});
it.each([{ ...body, vendorId: "foreign" }, { ...body, customerKeyHash: "b".repeat(43) }, { ...body, destination: { email: "synthetic@invalid.example" } }, { ...body, expectedStartTime: "invalid" }])("rejects caller-selected identity/contact or malformed revision", async input => {
  mocks.readJson.mockResolvedValue(input); expect((await POST(request(), context)).status).toBe(400); expect(mocks.confirm).not.toHaveBeenCalled();
});
it("confirms only server-resolved recipient and exact booking revision", async () => {
  const response = await POST(request(), context); expect(response.status).toBe(200);
  expect(mocks.confirm).toHaveBeenCalledWith(mocks.db, identity, "course-1", body); expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toEqual({ status: "scheduled", availableAt: "2026-10-08T07:00:00.000Z" });
});
it.each([["not_found", 404], ["verification_required", 409]])("preserves %s refusal", async (status, code) => {
  mocks.confirm.mockResolvedValue({ status }); expect((await POST(request(), context)).status).toBe(code);
});
it("invalid cursor is refused before identity resolution", async () => {
  expect((await GET(request("?after=..%2Fforeign"), context)).status).toBe(400); expect(mocks.session).not.toHaveBeenCalled();
});
it("lists only own bounded bookings with a current CSRF token", async () => {
  const response = await GET(request("?after=booking-0"), context); expect(response.status).toBe(200);
  expect(mocks.list).toHaveBeenCalledWith(mocks.db, identity, "course-1", "booking-0"); expect(await response.json()).toEqual({ bookings: [], nextAfter: null, csrfToken: "synthetic-csrf" });
});
it("revoked or foreign rights never issue a confirmation CSRF token", async () => {
  mocks.list.mockResolvedValue(null); expect((await GET(request(), context)).status).toBe(404); expect(mocks.token).not.toHaveBeenCalled();
});
it("unknown DB errors expose no private exception details", async () => {
  mocks.confirm.mockRejectedValue(new Error("private-synthetic-payload")); const response = await POST(request(), context); expect(response.status).toBe(503); expect(await response.text()).not.toContain("private-synthetic-payload");
});
