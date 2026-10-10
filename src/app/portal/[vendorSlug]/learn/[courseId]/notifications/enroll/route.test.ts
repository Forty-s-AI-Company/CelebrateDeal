import { afterEach,beforeEach,expect,it,vi } from "vitest";
const mocks=vi.hoisted(()=>({boundary:vi.fn(),readJson:vi.fn(),csrf:vi.fn(),session:vi.fn(),queue:vi.fn(),configuration:vi.fn(),origin:vi.fn(),db:{}}));
vi.mock("@/lib/api-security",()=>({requireSameOriginRequest:mocks.boundary,readJsonBody:mocks.readJson}));
vi.mock("@/lib/csrf",()=>({verifyCsrfToken:mocks.csrf}));
vi.mock("@/lib/student-portal-auth",()=>({requireStudentPortalSession:mocks.session}));
vi.mock("@/lib/app-url",()=>({getCanonicalAppUrl:mocks.origin}));
vi.mock("@/lib/db",()=>({getDb:()=>mocks.db}));
vi.mock("@/lib/learner-notification-job",()=>({readLearnerNotificationProviderConfiguration:mocks.configuration}));
vi.mock("@/lib/learner-notification-verification",async importOriginal=>({...await importOriginal<typeof import("@/lib/learner-notification-verification")>(),requestLearnerContactVerification:mocks.queue}));
import { POST } from "./route";
const identity={vendorId:"vendor-1",customerKeyHash:"a".repeat(43)};
const context={params:Promise.resolve({vendorSlug:"teacher",courseId:"course-1"})};
const input={channel:"email",expectedRevision:0,destination:{email:"synthetic@invalid.example"}};
const request=()=>new Request("https://app.example.test/portal/teacher/learn/course-1/notifications/enroll",{method:"POST",headers:{"x-csrf-token":"synthetic"}});
beforeEach(()=>{
 vi.clearAllMocks();mocks.origin.mockReturnValue("https://app.example.test");vi.stubEnv("LEARNER_NOTIFICATIONS_EXECUTOR_ENABLED","true");vi.stubEnv("LEARNER_NOTIFICATIONS_JOB_VENDOR_IDS","vendor-1");
 mocks.boundary.mockReturnValue(null);mocks.csrf.mockResolvedValue(true);mocks.readJson.mockResolvedValue(input);mocks.session.mockResolvedValue({session:identity});mocks.configuration.mockReturnValue({email:{enabled:true}});
 mocks.queue.mockResolvedValue({status:"challenge_created",challenge:{id:"challenge-1",expiresAt:"synthetic-expiry"},preference:{id:"private-id",channel:"email",enabled:false,revision:1,destinationVerifiedAt:null},delivery:{token:"private-proof",destination:{email:"private-contact"}}});
});
afterEach(()=>vi.unstubAllEnvs());
it("cross-origin denial precedes all proof work",async()=>{mocks.boundary.mockReturnValue(new Response(null,{status:403}));expect((await POST(request(),context)).status).toBe(403);expect(mocks.csrf).not.toHaveBeenCalled();expect(mocks.queue).not.toHaveBeenCalled();});
it("CSRF denial precedes session and queue",async()=>{mocks.csrf.mockResolvedValue(false);expect((await POST(request(),context)).status).toBe(403);expect(mocks.session).not.toHaveBeenCalled();});
it.each([{...input,vendorId:"foreign"},{...input,destination:{email:"invalid"}}])("rejects caller tenant and invalid destination",async raw=>{mocks.readJson.mockResolvedValue(raw);expect((await POST(request(),context)).status).toBe(400);expect(mocks.queue).not.toHaveBeenCalled();});
it.each(["","foreign","vendor-1,foreign/id"])("rejects unapproved/invalid tenant execution scope %s",async scope=>{vi.stubEnv("LEARNER_NOTIFICATIONS_JOB_VENDOR_IDS",scope);expect((await POST(request(),context)).status).toBe(503);expect(mocks.queue).not.toHaveBeenCalled();});
it("disabled executor or absent channel cannot strand a new proof",async()=>{vi.stubEnv("LEARNER_NOTIFICATIONS_EXECUTOR_ENABLED","false");expect((await POST(request(),context)).status).toBe(503);vi.stubEnv("LEARNER_NOTIFICATIONS_EXECUTOR_ENABLED","true");mocks.configuration.mockReturnValue({});expect((await POST(request(),context)).status).toBe(503);expect(mocks.queue).not.toHaveBeenCalled();});
it("queues authenticated scope without returning token/contact or private preference ID",async()=>{
 const response=await POST(request(),context);expect(response.status).toBe(202);expect(mocks.queue).toHaveBeenCalledWith(mocks.db,identity,"course-1",input);
 expect(await response.json()).toEqual({status:"challenge_queued",challenge:{id:"challenge-1",expiresAt:"synthetic-expiry"},preference:{channel:"email",enabled:false,revision:1,destinationVerifiedAt:null}});
 expect(response.headers.get("cache-control")).toBe("private, no-store");expect(mocks.readJson).toHaveBeenCalledWith(expect.any(Request),4096);
});
it.each([["not_found",404],["conflict",409],["rate_limited",429]])("preserves %s refusal",async(status,code)=>{mocks.queue.mockResolvedValue({status});const response=await POST(request(),context);expect(response.status).toBe(code);expect(await response.json()).toEqual({status});});
it("provider/DB details never enter error response",async()=>{mocks.queue.mockRejectedValue(new Error("private-contact"));const response=await POST(request(),context);expect(response.status).toBe(503);expect(await response.json()).toEqual({error:"verification_unavailable"});});

it("unsafe or unavailable canonical origin cannot enqueue a challenge",async()=>{mocks.origin.mockReturnValue("http://127.0.0.1");expect((await POST(request(),context)).status).toBe(503);mocks.origin.mockImplementation(()=>{throw new Error("private-runtime");});expect((await POST(request(),context)).status).toBe(503);expect(mocks.queue).not.toHaveBeenCalled();});
