import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ security: vi.fn(), limit: vi.fn(), hash: vi.fn(), transaction: vi.fn(), user: vi.fn(), vendor: vi.fn(), member: vi.fn(), preference: vi.fn(), consent: vi.fn(), audit: vi.fn(), session: vi.fn(), set: vi.fn(), delete: vi.fn(), revoked: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ set: mocks.set, delete: mocks.delete }) }));
vi.mock("@/lib/auth", () => ({ AUTH_COOKIE: "auth", LEGACY_VENDOR_COOKIE: "legacy", createUserSession: mocks.session, sessionCookieOptions: () => ({ httpOnly: true }) }));
vi.mock("@/lib/app-url", () => ({ getCanonicalAppUrl: () => "http://127.0.0.1:31027" }));
vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: mocks.security }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.limit }));
vi.mock("@/lib/password", () => ({ hashPasswordAsync: mocks.hash }));
// auditLog.findFirst is the revocation lookup; it resolves undefined (not revoked) unless a test says otherwise.
vi.mock("@/lib/db", () => ({ getDb: () => ({ $transaction: mocks.transaction, auditLog: { findFirst: mocks.revoked } }) }));
import { registerAction } from "./registration-actions";
import { merchantRegistrationPolicyVersions } from "@/lib/public-policy-content";
import { createMerchantRegistrationInvite } from "@/lib/merchant-registration-invite";
const policy = merchantRegistrationPolicyVersions();
function form(extra: Record<string, string | undefined> = {}) { const data = new FormData(); for (const [k,v] of Object.entries({ name: "Owner", workspaceName: "Workspace", email: "Owner@Example.test", password: "  synthetic password  ", acceptPolicies: "on", policyVersion: policy.consentVersion, ...extra })) if (v !== undefined) data.set(k,v); return data; }
beforeEach(() => {
 vi.resetAllMocks(); mocks.limit.mockResolvedValue(null); mocks.hash.mockResolvedValue("synthetic-hash"); mocks.user.mockResolvedValue({id:"user-1"}); mocks.vendor.mockResolvedValue({id:"vendor-1"}); mocks.session.mockResolvedValue({token:"synthetic-session",expiresAt:new Date("2026-12-01")});
 mocks.transaction.mockImplementation(async (fn) => fn({user:{create:mocks.user},vendor:{create:mocks.vendor},vendorMember:{create:mocks.member},userOnboardingPreference:{create:mocks.preference},userPolicyConsent:{create:mocks.consent},auditLog:{create:mocks.audit}}));
});
afterEach(() => { vi.unstubAllEnvs(); });
describe("workspace registration boundaries (REGISTRATION_MODE=open keeps the original behaviour)", () => {
 beforeEach(() => { vi.stubEnv("REGISTRATION_MODE", "open"); });
 it("ignores any invite field when registration is open", async () => { await expect(registerAction(form({invite:"not-a-token"}))).rejects.toThrow("redirect:/welcome"); expect(mocks.audit).toHaveBeenCalledWith({data:expect.objectContaining({after:{policyConsent:{termsVersion:policy.termsVersion,privacyVersion:policy.privacyVersion}}})}); });
 it("creates ownership and audit in one transaction before issuing the session", async () => {
  await expect(registerAction(form())).rejects.toThrow("redirect:/welcome");
  expect(mocks.hash).toHaveBeenCalledWith("synthetic password");
  expect(mocks.user).toHaveBeenCalledWith({data:{name:"Owner",email:"owner@example.test",passwordHash:"synthetic-hash"}});
  expect(mocks.member).toHaveBeenCalledWith({data:{vendorId:"vendor-1",userId:"user-1",role:"owner",status:"active"}});
  expect(mocks.preference).toHaveBeenCalledWith({data:expect.objectContaining({taskPanelCollapsed:true})}); expect(mocks.preference).toHaveBeenCalledOnce(); expect(mocks.audit).toHaveBeenCalledOnce();
  expect(mocks.audit.mock.invocationCallOrder[0]).toBeLessThan(mocks.session.mock.invocationCallOrder[0]);
  expect(mocks.set).toHaveBeenCalledWith("auth","synthetic-session",{httpOnly:true});
 });
 it("records the server's terms and privacy versions with the account (F-114)", async () => {
  await expect(registerAction(form())).rejects.toThrow("redirect:/welcome");
  expect(mocks.consent).toHaveBeenCalledWith({data:{userId:"user-1",vendorId:"vendor-1",context:"merchant_registration",termsVersion:policy.termsVersion,privacyVersion:policy.privacyVersion}});
  expect(mocks.audit).toHaveBeenCalledWith({data:expect.objectContaining({action:"registration_completed",after:{policyConsent:{termsVersion:policy.termsVersion,privacyVersion:policy.privacyVersion}}})});
  expect(mocks.consent.mock.invocationCallOrder[0]).toBeLessThan(mocks.session.mock.invocationCallOrder[0]);
 });
 it.each([{acceptPolicies:undefined},{acceptPolicies:""},{acceptPolicies:"off"}])("requires an explicit policy consent before any write %j", async (input) => {
  await expect(registerAction(form(input))).rejects.toThrow("redirect:/register?error=consent_required");
  expect(mocks.limit).not.toHaveBeenCalled(); expect(mocks.hash).not.toHaveBeenCalled(); expect(mocks.transaction).not.toHaveBeenCalled();
 });
 it.each([{policyVersion:undefined},{policyVersion:"2020.01.01"},{policyVersion:`${policy.consentVersion}x`}])("rejects consent to a policy version the server is not publishing %j", async (input) => {
  await expect(registerAction(form(input))).rejects.toThrow("redirect:/register?error=policy_updated");
  expect(mocks.transaction).not.toHaveBeenCalled(); expect(mocks.consent).not.toHaveBeenCalled();
 });
 it("recovers a committed account when session creation fails", async () => { mocks.session.mockRejectedValue(new Error("synthetic session failure")); await expect(registerAction(form())).rejects.toThrow("redirect:/login?registered=1"); expect(mocks.transaction).toHaveBeenCalledOnce(); expect(mocks.audit).toHaveBeenCalledOnce(); expect(mocks.set).not.toHaveBeenCalled(); });
 it("offers login recovery if cookie publication fails", async () => { mocks.set.mockImplementation(() => { throw new Error("synthetic cookie failure"); }); await expect(registerAction(form())).rejects.toThrow("redirect:/login?registered=1"); expect(mocks.transaction).toHaveBeenCalledOnce(); expect(mocks.session).toHaveBeenCalledOnce(); });
 it("rejects CSRF before rate limiting or writing", async () => { mocks.security.mockRejectedValue(new Error("csrf")); await expect(registerAction(form())).rejects.toThrow("csrf"); expect(mocks.limit).not.toHaveBeenCalled(); expect(mocks.transaction).not.toHaveBeenCalled(); });
 it.each([{email:"bad@"},{name:"x"},{workspaceName:"x"},{password:"short"},{password:"  bluewha  "},{password:"x".repeat(129)},{name:"x".repeat(121)}])("rejects invalid bounded input %j", async (input) => { await expect(registerAction(form(input))).rejects.toThrow("error=invalid"); expect(mocks.hash).not.toHaveBeenCalled(); expect(mocks.transaction).not.toHaveBeenCalled(); });
 it.each(["12345678","  PassWord123  ","qwertyuiop","zzzzzzzzzz","qwerty2026","12345678!","ｐａｓｓｗｏｒｄ"])("rejects the common password %j before rate limiting or writing", async (password) => { await expect(registerAction(form({password}))).rejects.toThrow("redirect:/register?error=common"); expect(mocks.limit).not.toHaveBeenCalled(); expect(mocks.hash).not.toHaveBeenCalled(); expect(mocks.transaction).not.toHaveBeenCalled(); });
 it.each(["owner-2026!","my owner pass"])("rejects a password containing the e-mail name %j as personal before writing", async (password) => { await expect(registerAction(form({password}))).rejects.toThrow("redirect:/register?error=personal"); expect(mocks.limit).not.toHaveBeenCalled(); expect(mocks.hash).not.toHaveBeenCalled(); expect(mocks.transaction).not.toHaveBeenCalled(); });
 it("does not treat a shared mailbox name as personal", async () => { await expect(registerAction(form({email:"sales@example.test",password:"sales team rocks 9"}))).rejects.toThrow("redirect:/welcome"); expect(mocks.hash).toHaveBeenCalledWith("sales team rocks 9"); });
 it("accepts an 8-character password that is not common", async () => { await expect(registerAction(form({password:"bluewhal"}))).rejects.toThrow("redirect:/welcome"); expect(mocks.hash).toHaveBeenCalledWith("bluewhal"); });
 it.each([429,503])("fails closed on rate-limit status %s", async (status) => { mocks.limit.mockResolvedValue(new Response(null,{status})); await expect(registerAction(form())).rejects.toThrow(status===429?"error=rate_limited":"error=temporarily_unavailable"); expect(mocks.hash).not.toHaveBeenCalled(); expect(mocks.session).not.toHaveBeenCalled(); });
 it.each([{code:"P2002",error:"exists"},{code:"P1001",error:"temporarily_unavailable"}])("distinguishes duplicate input from service failure $code", async ({code,error}) => { mocks.transaction.mockRejectedValue({code}); await expect(registerAction(form())).rejects.toThrow(`error=${error}`); expect(mocks.session).not.toHaveBeenCalled(); expect(mocks.set).not.toHaveBeenCalled(); });
});

describe("invite-only registration (closed beta default)", () => {
  const SECRET = "synthetic-registration-invite-secret-32-bytes";
  const noWrites = () => {
    expect(mocks.limit).not.toHaveBeenCalled();
    expect(mocks.hash).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.user).not.toHaveBeenCalled();
    expect(mocks.vendor).not.toHaveBeenCalled();
    expect(mocks.session).not.toHaveBeenCalled();
  };
  beforeEach(() => {
    vi.stubEnv("CSRF_SECRET", SECRET);
    vi.stubEnv("REGISTRATION_MODE", "");
  });

  it.each([undefined, "invite", "INVITE", "opened"])("is invite-only when REGISTRATION_MODE is %j", async (mode) => {
    if (mode !== undefined) vi.stubEnv("REGISTRATION_MODE", mode);
    else delete process.env.REGISTRATION_MODE;
    await expect(registerAction(form())).rejects.toThrow(/^redirect:\/register\?error=invite_required$/u);
    noWrites();
  });

  it("checks the invitation before consent or input so a closed form reveals nothing else", async () => {
    await expect(registerAction(form({ acceptPolicies: undefined, password: "short", email: "bad@" }))).rejects.toThrow(/^redirect:\/register\?error=invite_required$/u);
    noWrites();
  });

  it("rejects malformed, tampered, expired and foreign-secret invitations without writing", async () => {
    const valid = createMerchantRegistrationInvite({ email: "owner@example.test" }).token;
    const expired = createMerchantRegistrationInvite({ email: "owner@example.test", now: new Date(Date.now() - 15 * 24 * 60 * 60 * 1_000) }).token;
    vi.stubEnv("CSRF_SECRET", "another-synthetic-secret-also-32-bytes-long");
    const foreign = createMerchantRegistrationInvite({ email: "owner@example.test" }).token;
    vi.stubEnv("CSRF_SECRET", SECRET);
    for (const invite of ["", "garbage", `${valid.slice(0, -2)}xx`, expired, foreign, "x".repeat(5_000)]) {
      await expect(registerAction(form({ invite }))).rejects.toThrow(/^redirect:\/register\?error=invite_required$/u);
    }
    noWrites();
  });

  it("requires the submitted email to be the invited one", async () => {
    const { token } = createMerchantRegistrationInvite({ email: "invited@example.test" });
    await expect(registerAction(form({ invite: token }))).rejects.toThrow(`redirect:/register?error=invite_mismatch&invite=${encodeURIComponent(token)}`);
    noWrites();
  });

  it("creates the workspace for a valid invitation and audits its id, never the token", async () => {
    const invite = createMerchantRegistrationInvite({ email: "owner@example.test" });
    await expect(registerAction(form({ invite: invite.token, email: "  OWNER@example.test " }))).rejects.toThrow("redirect:/welcome");
    expect(mocks.user).toHaveBeenCalledWith({ data: { name: "Owner", email: "owner@example.test", passwordHash: "synthetic-hash" } });
    expect(mocks.member).toHaveBeenCalledWith({ data: { vendorId: "vendor-1", userId: "user-1", role: "owner", status: "active" } });
    expect(mocks.consent).toHaveBeenCalledOnce();
    expect(mocks.audit).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "registration_completed", after: { policyConsent: { termsVersion: policy.termsVersion, privacyVersion: policy.privacyVersion }, registrationInvite: { jti: invite.jti } } }) });
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain(invite.token);
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain(invite.token.split(".")[2]);
    expect(mocks.set).toHaveBeenCalledWith("auth", "synthetic-session", { httpOnly: true });
  });

  it("keeps the verified invitation on every retryable error so the invitee can fix the form", async () => {
    const { token } = createMerchantRegistrationInvite({ email: "owner@example.test" });
    const keep = `&invite=${encodeURIComponent(token)}`;
    await expect(registerAction(form({ invite: token, acceptPolicies: undefined }))).rejects.toThrow(`redirect:/register?error=consent_required${keep}`);
    await expect(registerAction(form({ invite: token, policyVersion: "2020.01.01" }))).rejects.toThrow(`redirect:/register?error=policy_updated${keep}`);
    await expect(registerAction(form({ invite: token, name: "x" }))).rejects.toThrow(`redirect:/register?error=invalid${keep}`);
    await expect(registerAction(form({ invite: token, password: "12345678" }))).rejects.toThrow(`redirect:/register?error=common${keep}`);
    mocks.limit.mockResolvedValueOnce(new Response(null, { status: 429 }));
    await expect(registerAction(form({ invite: token }))).rejects.toThrow(`redirect:/register?error=rate_limited${keep}`);
    mocks.transaction.mockRejectedValueOnce({ code: "P2002" });
    await expect(registerAction(form({ invite: token }))).rejects.toThrow(`redirect:/register?error=exists${keep}`);
    expect(mocks.session).not.toHaveBeenCalled();
  });

  it("still rejects CSRF before looking at the invitation", async () => {
    mocks.security.mockRejectedValue(new Error("csrf"));
    const { token } = createMerchantRegistrationInvite({ email: "owner@example.test" });
    await expect(registerAction(form({ invite: token }))).rejects.toThrow("csrf");
    noWrites();
    expect(mocks.revoked).not.toHaveBeenCalled();
  });

  it("rejects a validly signed but revoked invitation without writing", async () => {
    const invite = createMerchantRegistrationInvite({ email: "owner@example.test" });
    mocks.revoked.mockResolvedValue({ id: "audit-revoked" });
    await expect(registerAction(form({ invite: invite.token }))).rejects.toThrow(/^redirect:\/register\?error=invite_revoked$/u);
    expect(mocks.revoked).toHaveBeenCalledWith({
      where: { targetType: "MerchantRegistrationInvite", targetId: invite.jti, action: "merchant_registration_invite_revoked", vendorId: null },
      select: { id: true },
    });
    noWrites();
  });

  it("does not query revocations for an invalid token", async () => {
    await expect(registerAction(form({ invite: "garbage" }))).rejects.toThrow("error=invite_required");
    expect(mocks.revoked).not.toHaveBeenCalled();
  });
});

describe("invitation recording in open mode (n-3)", () => {
  const SECRET = "synthetic-registration-invite-secret-32-bytes";
  const consentOnly = { policyConsent: { termsVersion: policy.termsVersion, privacyVersion: policy.privacyVersion } };
  beforeEach(() => {
    vi.stubEnv("CSRF_SECRET", SECRET);
    vi.stubEnv("REGISTRATION_MODE", "open");
  });

  it("records the jti of a valid matching invitation even when registration is open", async () => {
    const invite = createMerchantRegistrationInvite({ email: "owner@example.test" });
    await expect(registerAction(form({ invite: invite.token }))).rejects.toThrow("redirect:/welcome");
    expect(mocks.audit).toHaveBeenCalledWith({ data: expect.objectContaining({ after: { ...consentOnly, registrationInvite: { jti: invite.jti } } }) });
  });

  it("registers without recording a revoked or non-matching invitation", async () => {
    const other = createMerchantRegistrationInvite({ email: "someone-else@example.test" });
    await expect(registerAction(form({ invite: other.token }))).rejects.toThrow("redirect:/welcome");
    const revoked = createMerchantRegistrationInvite({ email: "owner@example.test" });
    mocks.revoked.mockResolvedValue({ id: "audit-revoked" });
    await expect(registerAction(form({ invite: revoked.token }))).rejects.toThrow("redirect:/welcome");
    for (const call of mocks.audit.mock.calls) expect(call[0]).toEqual({ data: expect.objectContaining({ after: consentOnly }) });
    expect(mocks.audit).toHaveBeenCalledTimes(2);
  });
});
