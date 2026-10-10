import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ boundary: vi.fn(), readJson: vi.fn(), csrf: vi.fn(), session: vi.fn(), consume: vi.fn(), db: {} }));
vi.mock("@/lib/api-security", () => ({ requireSameOriginRequest: mocks.boundary, readJsonBody: mocks.readJson }));
vi.mock("@/lib/csrf", () => ({ verifyCsrfToken: mocks.csrf }));
vi.mock("@/lib/student-portal-auth", () => ({ requireStudentPortalSession: mocks.session }));
vi.mock("@/lib/db", () => ({ getDb: () => mocks.db }));
vi.mock("@/lib/learner-notification-verification", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/learner-notification-verification")>(), consumeLearnerContactVerification: mocks.consume }));
import { POST } from "./route";
const identity = { vendorId: "vendor-1", customerKeyHash: "a".repeat(43) };
const context = { params: Promise.resolve({ vendorSlug: "teacher", courseId: "course-1" }) };
const input = { challengeId: "challenge-1", token: "b".repeat(43) };
const request = () => new Request("https://app.example.test/portal/teacher/learn/course-1/notifications/verify", { method: "POST", headers: { "x-csrf-token": "synthetic" } });
beforeEach(() => {
 vi.clearAllMocks(); mocks.boundary.mockReturnValue(null); mocks.csrf.mockResolvedValue(true);
 mocks.readJson.mockResolvedValue(input); mocks.session.mockResolvedValue({ session: identity });
 mocks.consume.mockResolvedValue({ status: "verified", preference: { channel: "sms", enabled: false, revision: 3, destinationVerifiedAt: null, token: "private-proof", destinationEncryptedEnvelope: "private-contact" } });
});
it("refuses cross-origin before session or proof processing", async () => {
 mocks.boundary.mockReturnValue(new Response(null, { status: 403 })); expect((await POST(request(),context)).status).toBe(403);
 expect(mocks.csrf).not.toHaveBeenCalled(); expect(mocks.consume).not.toHaveBeenCalled();
});
it("refuses missing CSRF before session", async () => {
 mocks.csrf.mockResolvedValue(false); expect((await POST(request(),context)).status).toBe(403); expect(mocks.session).not.toHaveBeenCalled();
});
it.each([{ ...input, vendorId: "foreign" }, { ...input, token: "short" }])("refuses caller scope or malformed proof", async raw => {
 mocks.readJson.mockResolvedValue(raw); expect((await POST(request(),context)).status).toBe(400); expect(mocks.consume).not.toHaveBeenCalled();
});
it("uses authenticated tenant and projects only public consent fields", async () => {
 const response=await POST(request(),context);
 expect(mocks.readJson).toHaveBeenCalledWith(expect.any(Request),4096);
 expect(mocks.consume).toHaveBeenCalledWith(mocks.db,identity,"course-1",input);
 expect(await response.json()).toEqual({ status: "verified", preference: { channel: "sms", enabled: false, revision: 3, destinationVerifiedAt: null } });
 expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(response.headers.get("vary")).toBe("Cookie");
});
it.each([["not_found",404],["invalid_challenge",409]])("preserves %s refusal without proof echo", async (status,code) => {
 mocks.consume.mockResolvedValue({ status }); const response=await POST(request(),context);
 expect(response.status).toBe(code); expect(await response.json()).toEqual({ status });
});
it("does not expose database errors", async () => {
 mocks.consume.mockRejectedValue(new Error("private-contact")); const response=await POST(request(),context);
 expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: "verification_unavailable" });
});
