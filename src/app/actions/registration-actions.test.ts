import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ security: vi.fn(), limit: vi.fn(), hash: vi.fn(), transaction: vi.fn(), user: vi.fn(), vendor: vi.fn(), member: vi.fn(), preference: vi.fn(), audit: vi.fn(), session: vi.fn(), set: vi.fn(), delete: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ set: mocks.set, delete: mocks.delete }) }));
vi.mock("@/lib/auth", () => ({ AUTH_COOKIE: "auth", LEGACY_VENDOR_COOKIE: "legacy", createUserSession: mocks.session, sessionCookieOptions: () => ({ httpOnly: true }) }));
vi.mock("@/lib/app-url", () => ({ getCanonicalAppUrl: () => "http://127.0.0.1:31027" }));
vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: mocks.security }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.limit }));
vi.mock("@/lib/password", () => ({ hashPasswordAsync: mocks.hash }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ $transaction: mocks.transaction }) }));
import { registerAction } from "./registration-actions";
function form(extra: Record<string, string | undefined> = {}) { const data = new FormData(); for (const [k,v] of Object.entries({ name: "Owner", workspaceName: "Workspace", email: "Owner@Example.test", password: "  synthetic password  ", ...extra })) if (v !== undefined) data.set(k,v); return data; }
beforeEach(() => {
 vi.resetAllMocks(); mocks.limit.mockResolvedValue(null); mocks.hash.mockResolvedValue("synthetic-hash"); mocks.user.mockResolvedValue({id:"user-1"}); mocks.vendor.mockResolvedValue({id:"vendor-1"}); mocks.session.mockResolvedValue({token:"synthetic-session",expiresAt:new Date("2026-12-01")});
 mocks.transaction.mockImplementation(async (fn) => fn({user:{create:mocks.user},vendor:{create:mocks.vendor},vendorMember:{create:mocks.member},userOnboardingPreference:{create:mocks.preference},auditLog:{create:mocks.audit}}));
});
describe("workspace registration boundaries", () => {
 it("creates ownership and audit in one transaction before issuing the session", async () => {
  await expect(registerAction(form())).rejects.toThrow("redirect:/welcome");
  expect(mocks.hash).toHaveBeenCalledWith("  synthetic password  ");
  expect(mocks.user).toHaveBeenCalledWith({data:{name:"Owner",email:"owner@example.test",passwordHash:"synthetic-hash"}});
  expect(mocks.member).toHaveBeenCalledWith({data:{vendorId:"vendor-1",userId:"user-1",role:"owner",status:"active"}});
  expect(mocks.preference).toHaveBeenCalledOnce(); expect(mocks.audit).toHaveBeenCalledOnce();
  expect(mocks.audit.mock.invocationCallOrder[0]).toBeLessThan(mocks.session.mock.invocationCallOrder[0]);
  expect(mocks.set).toHaveBeenCalledWith("auth","synthetic-session",{httpOnly:true});
 });
 it("rejects CSRF before rate limiting or writing", async () => { mocks.security.mockRejectedValue(new Error("csrf")); await expect(registerAction(form())).rejects.toThrow("csrf"); expect(mocks.limit).not.toHaveBeenCalled(); expect(mocks.transaction).not.toHaveBeenCalled(); });
 it.each([{email:"bad@"},{name:"x"},{workspaceName:"x"},{password:"short"},{password:"x".repeat(129)},{name:"x".repeat(121)}])("rejects invalid bounded input %j", async (input) => { await expect(registerAction(form(input))).rejects.toThrow("error=invalid"); expect(mocks.hash).not.toHaveBeenCalled(); expect(mocks.transaction).not.toHaveBeenCalled(); });
 it.each([429,503])("fails closed on rate-limit status %s", async (status) => { mocks.limit.mockResolvedValue(new Response(null,{status})); await expect(registerAction(form())).rejects.toThrow(status===429?"error=rate_limited":"error=temporarily_unavailable"); expect(mocks.hash).not.toHaveBeenCalled(); expect(mocks.session).not.toHaveBeenCalled(); });
 it.each([{code:"P2002",error:"exists"},{code:"P1001",error:"temporarily_unavailable"}])("distinguishes duplicate input from service failure $code", async ({code,error}) => { mocks.transaction.mockRejectedValue({code}); await expect(registerAction(form())).rejects.toThrow(`error=${error}`); expect(mocks.session).not.toHaveBeenCalled(); expect(mocks.set).not.toHaveBeenCalled(); });
});
