import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ boundary: vi.fn(), readJson: vi.fn(), csrf: vi.fn(), token: vi.fn(), session: vi.fn(), list: vi.fn(), save: vi.fn(), db: {} }));
vi.mock("@/lib/api-security", () => ({ requireSameOriginRequest: mocks.boundary, readJsonBody: mocks.readJson }));
vi.mock("@/lib/csrf", () => ({ verifyCsrfToken: mocks.csrf, getCsrfToken: mocks.token }));
vi.mock("@/lib/student-portal-auth", () => ({ requireStudentPortalSession: mocks.session }));
vi.mock("@/lib/learner-notification-preferences", () => ({ listLearnerNotificationPreferences: mocks.list, saveLearnerNotificationConsent: mocks.save }));
vi.mock("@/lib/db", () => ({ getDb: () => mocks.db }));
import { GET, POST } from "./route";
const identity = { vendorId: "vendor-1", customerKeyHash: "a".repeat(43) };
const context = { params: Promise.resolve({ vendorSlug: "teacher", courseId: "course-1" }) };
const request = () => new Request("https://app.example.test/portal/teacher/learn/course-1/notifications", { method: "POST", headers: { "x-csrf-token": "synthetic" } });
beforeEach(() => {
 vi.clearAllMocks(); vi.stubEnv("LEARNER_NOTIFICATIONS_EXECUTOR_ENABLED","false"); mocks.boundary.mockReturnValue(null); mocks.csrf.mockResolvedValue(true);
 mocks.readJson.mockResolvedValue({ channel: "sms", enabled: false, expectedRevision: 1 });
 mocks.session.mockResolvedValue({ session: identity }); mocks.list.mockResolvedValue([]); mocks.token.mockResolvedValue("synthetic-csrf");
 mocks.save.mockResolvedValue({ status: "saved", preference: { channel: "sms", enabled: false, revision: 2, destinationVerifiedAt: null } });
});
it("fails CSRF before session or database work", async () => {
 mocks.csrf.mockResolvedValue(false); expect((await POST(request(), context)).status).toBe(403);
 expect(mocks.session).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
});
it("same-origin rejection never reaches token or session", async () => {
 mocks.boundary.mockReturnValue(new Response(null, { status: 403 }));
 expect((await POST(request(), context)).status).toBe(403); expect(mocks.csrf).not.toHaveBeenCalled();
 expect((await GET(request(), context)).status).toBe(403); expect(mocks.session).not.toHaveBeenCalled();
});
it("rejects caller-selected tenant and destination", async () => {
 mocks.readJson.mockResolvedValue({ channel: "sms", enabled: true, expectedRevision: 1, vendorId: "foreign", phone: "+886900000001" });
 expect((await POST(request(), context)).status).toBe(400); expect(mocks.save).not.toHaveBeenCalled();
});
it("uses server-resolved identity and private consent state", async () => {
 const response = await POST(request(), context); expect(response.status).toBe(200);
 expect(mocks.save).toHaveBeenCalledWith(mocks.db, identity, "course-1", { channel: "sms", enabled: false, expectedRevision: 1 });
 expect(response.headers.get("cache-control")).toBe("private, no-store");
});
it.each([["not_found",404],["conflict",409],["verification_required",409]])("preserves %s refusal", async (status, code) => {
 mocks.save.mockResolvedValue({ status }); expect((await POST(request(), context)).status).toBe(code);
});
it("does not issue CSRF token without current purchase rights", async () => {
 mocks.list.mockResolvedValue(null); expect((await GET(request(), context)).status).toBe(404); expect(mocks.token).not.toHaveBeenCalled();
});

afterEach(()=>vi.unstubAllEnvs());
it("GET exposes only public consent state, CSRF and channel capability metadata",async()=>{
 const response=await GET(request(),context);expect(response.status).toBe(200);expect(await response.json()).toEqual({preferences:[],csrfToken:"synthetic-csrf",capabilities:{availableChannels:[],pushPublicKey:null}});expect(response.headers.get("cache-control")).toBe("private, no-store");
});
