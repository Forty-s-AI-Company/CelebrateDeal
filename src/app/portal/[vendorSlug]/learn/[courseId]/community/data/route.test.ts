import {randomUUID} from "node:crypto";
import {beforeEach,describe,expect,it,vi} from "vitest";
import {CommunityConflict} from "@/lib/course-community";
const mocks=vi.hoisted(()=>({session:vi.fn(),feed:vi.fn(),replies:vi.fn(),mutate:vi.fn(),csrf:vi.fn(),token:vi.fn()}));
vi.mock("@/lib/student-portal-auth",()=>({requireStudentPortalSession:mocks.session}));
vi.mock("@/lib/db",()=>({getDb:()=>({syntheticDatabase:true})}));
vi.mock("@/lib/csrf",()=>({verifyCsrfToken:mocks.csrf,getCsrfToken:mocks.token}));
vi.mock("@/lib/course-community",async importOriginal=>({...await importOriginal<typeof import("@/lib/course-community")>(),getCourseCommunity:mocks.feed,getCourseCommunityReplies:mocks.replies,mutateCourseCommunity:mocks.mutate}));
import {GET,POST} from "./route";
const context={params:Promise.resolve({vendorSlug:"teacher",courseId:"course_a"})};
const scope={vendorId:"vendor_a",customerKeyHash:"synthetic-hash"};
const body=()=>({operation:"post",requestKey:randomUUID(),authorName:"學員",body:"心得"});
function request(method="GET",query="",input:unknown=body(),headers:Record<string,string>={}){
 return new Request(`https://app.example.test/portal/teacher/learn/course_a/community/data${query}`,{method,headers:{origin:"https://app.example.test","x-celebratedeal-client":"web","content-type":"application/json","x-csrf-token":"synthetic-csrf",...headers},...(method==="POST"?{body:JSON.stringify(input)}:{})});
}
beforeEach(()=>{vi.clearAllMocks();mocks.session.mockResolvedValue({session:scope});mocks.csrf.mockResolvedValue(true);mocks.token.mockResolvedValue("synthetic-token");mocks.feed.mockResolvedValue({posts:[],nextCursor:null});mocks.replies.mockResolvedValue({replies:[],nextCursor:null});mocks.mutate.mockResolvedValue({id:"post_a"});});
describe("purchased-course community data route",()=>{
 it("binds feed and thread to the portal session and returns private CSRF refresh",async()=>{
  const response=await GET(request(),context);expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toBe("private, no-store");expect(response.headers.get("vary")).toBe("Cookie");expect(await response.json()).toMatchObject({csrfToken:"synthetic-token"});
  expect(mocks.feed).toHaveBeenCalledWith(expect.anything(),scope,"course_a",undefined);
  await GET(request("GET","?postId=post_a&cursor=reply_a"),context);expect(mocks.replies).toHaveBeenCalledWith(expect.anything(),scope,"course_a","post_a","reply_a");
 });
 it("rejects foreign origin and missing client marker before session access",async()=>{
  expect((await GET(request("GET","",{}, {origin:"https://foreign.example.test"}),context)).status).toBe(403);
  expect((await POST(request("POST","",body(),{"x-celebratedeal-client":""}),context)).status).toBe(403);expect(mocks.session).not.toHaveBeenCalled();
 });
 it.each(["?cursor=a&cursor=b","?vendorId=foreign","?cursor=../foreign"])("rejects malformed query %s before authentication",async query=>{expect((await GET(request("GET",query),context)).status).toBe(400);expect(mocks.session).not.toHaveBeenCalled();});
 it("rejects CSRF and caller identity before domain mutation",async()=>{
  mocks.csrf.mockResolvedValue(false);expect((await POST(request("POST"),context)).status).toBe(403);expect(mocks.session).not.toHaveBeenCalled();
  mocks.csrf.mockResolvedValue(true);expect((await POST(request("POST","",{...body(),vendorId:"foreign"}),context)).status).toBe(400);expect(mocks.mutate).not.toHaveBeenCalled();
 });
 it("passes only validated content and the session identity to mutation",async()=>{const input=body();const response=await POST(request("POST","",input),context);expect(response.status).toBe(200);expect(mocks.mutate).toHaveBeenCalledWith(expect.anything(),scope,"course_a",input);});
 it("denies revoked entitlement and masks internal failures",async()=>{
  mocks.feed.mockResolvedValue(null);expect((await GET(request(),context)).status).toBe(404);
  mocks.mutate.mockResolvedValue(null);expect((await POST(request("POST"),context)).status).toBe(404);
  mocks.mutate.mockRejectedValue(new CommunityConflict("synthetic internal detail"));const conflict=await POST(request("POST"),context);expect(conflict.status).toBe(409);expect(await conflict.json()).toEqual({error:"request_conflict"});
  mocks.mutate.mockRejectedValue(new Error("synthetic internal detail"));const unavailable=await POST(request("POST"),context);expect(unavailable.status).toBe(503);expect(await unavailable.json()).toEqual({error:"unavailable"});
 });
});
