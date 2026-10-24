import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const runtime=vi.hoisted(()=>({database:null as unknown,cookies:new Map<string,string>()}));
vi.mock("@/lib/db",()=>({getDb:()=>runtime.database}));
vi.mock("next/headers",()=>({headers:async()=>new Headers(),cookies:async()=>({get:(key:string)=>runtime.cookies.has(key)?{value:runtime.cookies.get(key)}:undefined,set:(key:string,value:string)=>runtime.cookies.set(key,value),delete:(key:string)=>runtime.cookies.delete(key)})}));
vi.mock("next/navigation",()=>({redirect:(path:string)=>{throw new Error(`redirect:${path}`);}}));
vi.mock("@/lib/csrf",()=>({assertServerActionSecurity:async()=>undefined}));
vi.mock("@/lib/rate-limit",()=>({checkRateLimit:async()=>null}));
vi.mock("@/lib/app-url",async(importOriginal)=>({...await importOriginal<typeof import("@/lib/app-url")>(),getCanonicalAppUrl:()=>"http://127.0.0.1:31027"}));
import { registerAction } from "./registration-actions";
import { loginAction, logoutAction } from "./auth-security-actions";
import { AUTH_COOKIE } from "@/lib/auth";
import { merchantRegistrationPolicyVersions } from "@/lib/public-policy-content";
import { createMerchantRegistrationInvite } from "@/lib/merchant-registration-invite";
const policy=merchantRegistrationPolicyVersions();
const db=new PrismaClient();let email="";
// Invite mode is the default; every form carries a valid invitation for its email unless a test overrides it.
function form(password="SyntheticPassword123!",extra:Record<string,string|undefined>={}){const f=new FormData();for(const[k,v]of Object.entries({name:"Synthetic owner",workspaceName:"Synthetic workspace",email,password,acceptPolicies:"on",policyVersion:policy.consentVersion,invite:createMerchantRegistrationInvite({email}).token,...extra}))if(v!==undefined)f.set(k,v);return f;}
beforeEach(()=>{vi.stubEnv("CSRF_SECRET","synthetic-registration-db-invite-secret-32b");vi.stubEnv("REGISTRATION_MODE","");runtime.database=db;runtime.cookies.clear();email=`registration-${randomUUID()}@example.test`;});
afterEach(async()=>{runtime.database=db;const users=await db.user.findMany({where:{email},select:{id:true}});const vendors=await db.vendor.findMany({where:{email},select:{id:true}});await db.auditLog.deleteMany({where:{OR:[{actorId:{in:users.map(u=>u.id)}},{vendorId:{in:vendors.map(v=>v.id)}}]}});await db.vendor.deleteMany({where:{email}});await db.user.deleteMany({where:{email}});runtime.cookies.clear();});
afterEach(()=>{vi.unstubAllEnvs();});
afterAll(async()=>db.$disconnect());
describe("registration PostgreSQL and real password/session integration",()=>{
 it.each(["SyntheticPassword123!","  SyntheticPassword123!  "])("registers, logs out and logs back in with the same submitted password (%#)",async(password)=>{
  const data=form(password);await expect(registerAction(data)).rejects.toThrow("redirect:/welcome");
  const user=await db.user.findUniqueOrThrow({where:{email}});const vendor=await db.vendor.findUniqueOrThrow({where:{email}});
  expect(await db.vendorMember.count({where:{vendorId:vendor.id,userId:user.id,role:"owner",status:"active"}})).toBe(1);
  expect(await db.userOnboardingPreference.count({where:{userId:user.id,vendorId:vendor.id}})).toBe(1);
  expect(await db.userPolicyConsent.findMany({where:{userId:user.id},select:{vendorId:true,context:true,termsVersion:true,privacyVersion:true,acceptedAt:true}})).toEqual([{vendorId:vendor.id,context:"merchant_registration",termsVersion:policy.termsVersion,privacyVersion:policy.privacyVersion,acceptedAt:expect.any(Date)}]);
  expect(runtime.cookies.has(AUTH_COOKIE)).toBe(true);
  await expect(logoutAction(new FormData())).rejects.toThrow("redirect:/login");expect(runtime.cookies.has(AUTH_COOKIE)).toBe(false);
  await expect(loginAction(data)).rejects.toThrow("redirect:/dashboard");expect(runtime.cookies.has(AUTH_COOKIE)).toBe(true);
  expect(await db.userSession.count({where:{userId:user.id,revokedAt:null,mfaVerifiedAt:null}})).toBe(1);
 });
 it("rolls back all provisioning when its audit insert fails",async()=>{
  runtime.database=db.$extends({query:{auditLog:{async create(){throw new Error("synthetic audit failure");}}}});
  await expect(registerAction(form())).rejects.toThrow("error=temporarily_unavailable");expect(await db.user.count({where:{email}})).toBe(0);expect(await db.userPolicyConsent.count({where:{user:{email}}})).toBe(0);expect(await db.vendor.count({where:{email}})).toBe(0);expect(runtime.cookies.has(AUTH_COOKIE)).toBe(false);
 });
 it("keeps one recoverable account when session creation fails",async()=>{
  runtime.database=db.$extends({query:{userSession:{async create(){throw new Error("synthetic session failure");}}}});
  await expect(registerAction(form())).rejects.toThrow("redirect:/login?registered=1");expect(await db.user.count({where:{email}})).toBe(1);expect(await db.vendor.count({where:{email}})).toBe(1);expect(runtime.cookies.has(AUTH_COOKIE)).toBe(false);
  runtime.database=db;await expect(loginAction(form())).rejects.toThrow("redirect:/dashboard");expect(runtime.cookies.has(AUTH_COOKIE)).toBe(true);
 });
 it("rejects duplicate registration without adding a second workspace",async()=>{
  await expect(registerAction(form())).rejects.toThrow("redirect:/welcome");await expect(logoutAction(new FormData())).rejects.toThrow("redirect:/login");await expect(registerAction(form())).rejects.toThrow("error=exists");expect(await db.vendor.count({where:{email}})).toBe(1);expect(await db.user.count({where:{email}})).toBe(1);expect(runtime.cookies.has(AUTH_COOKIE)).toBe(false);
 });
 it("creates nothing without a valid invitation for the submitted email in invite mode",async()=>{
  const other=createMerchantRegistrationInvite({email:`other-${randomUUID()}@example.test`}).token;
  for(const invite of [undefined,"garbage",createMerchantRegistrationInvite({email,now:new Date(Date.now()-15*24*60*60*1000)}).token])await expect(registerAction(form(undefined,{invite}))).rejects.toThrow(/^redirect:\/register\?error=invite_required$/u);
  await expect(registerAction(form(undefined,{invite:other}))).rejects.toThrow("redirect:/register?error=invite_mismatch&invite=");
  expect(await db.user.count({where:{email}})).toBe(0);expect(await db.vendor.count({where:{email}})).toBe(0);expect(await db.userPolicyConsent.count({where:{user:{email}}})).toBe(0);expect(runtime.cookies.has(AUTH_COOKIE)).toBe(false);
 });
 it("records which invitation created the workspace without storing the token",async()=>{
  const invite=createMerchantRegistrationInvite({email});
  await expect(registerAction(form(undefined,{invite:invite.token}))).rejects.toThrow("redirect:/welcome");
  const user=await db.user.findUniqueOrThrow({where:{email}});const audit=await db.auditLog.findFirstOrThrow({where:{actorId:user.id,action:"registration_completed"}});
  expect(audit.after).toMatchObject({registrationInvite:{jti:invite.jti}});expect(JSON.stringify(audit)).not.toContain(invite.token.split(".")[2]);
 });
 it("rejects a revoked invitation through the indexed audit lookup without writing",async()=>{
  const invite=createMerchantRegistrationInvite({email});
  await db.auditLog.create({data:{vendorId:null,actorId:null,actorLabel:"platform_admin",action:"merchant_registration_invite_revoked",targetType:"MerchantRegistrationInvite",targetId:invite.jti}});
  try{
   await expect(registerAction(form(undefined,{invite:invite.token}))).rejects.toThrow(/^redirect:\/register\?error=invite_revoked$/u);
   expect(await db.user.count({where:{email}})).toBe(0);expect(await db.vendor.count({where:{email}})).toBe(0);expect(runtime.cookies.has(AUTH_COOKIE)).toBe(false);
   // Another invitation for the same address is unaffected.
   await expect(registerAction(form())).rejects.toThrow("redirect:/welcome");
  }finally{await db.auditLog.deleteMany({where:{targetType:"MerchantRegistrationInvite",targetId:invite.jti}});}
 });
 it("registers without an invitation only when REGISTRATION_MODE=open",async()=>{
  vi.stubEnv("REGISTRATION_MODE","open");
  await expect(registerAction(form(undefined,{invite:undefined}))).rejects.toThrow("redirect:/welcome");
  expect(await db.vendor.count({where:{email}})).toBe(1);expect(await db.user.count({where:{email}})).toBe(1);
 });
});
