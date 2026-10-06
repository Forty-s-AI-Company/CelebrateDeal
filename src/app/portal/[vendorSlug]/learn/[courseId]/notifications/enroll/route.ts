import { NextResponse } from "next/server";
import { requireSameOriginRequest, readJsonBody } from "@/lib/api-security";
import { verifyCsrfToken } from "@/lib/csrf";
import { getCanonicalAppUrl } from "@/lib/app-url";
import { getDb } from "@/lib/db";
import { requireStudentPortalSession } from "@/lib/student-portal-auth";
import { requestLearnerContactVerification, LearnerContactEnrollmentInput } from "@/lib/learner-notification-verification";
import { readLearnerNotificationProviderConfiguration } from "@/lib/learner-notification-job";

type Context = { params: Promise<{ vendorSlug: string; courseId: string }> };
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };

/** Browser can request proof only for its current course/session. Provider
 * credentials, destination proof, worker nonce and encrypted payload stay private. */
export async function POST(request: Request, { params }: Context) {
 const boundary=requireSameOriginRequest(request,{requireClientHeader:true});if(boundary)return boundary;
 if(!await verifyCsrfToken(request.headers.get("x-csrf-token")))return NextResponse.json({error:"forbidden"},{status:403,headers});
 const input=LearnerContactEnrollmentInput.safeParse(await readJsonBody(request,4096));
 if(!input.success)return NextResponse.json({error:"invalid_destination"},{status:400,headers});
 const {vendorSlug,courseId}=await params;const {session}=await requireStudentPortalSession(vendorSlug);
 try{if(new URL(getCanonicalAppUrl()).protocol!=="https:")return NextResponse.json({error:"channel_unavailable"},{status:503,headers});}
 catch{return NextResponse.json({error:"channel_unavailable"},{status:503,headers});}
 const approved=(process.env.LEARNER_NOTIFICATIONS_JOB_VENDOR_IDS??"").split(",").map(value=>value.trim()).filter(Boolean);
 if(process.env.LEARNER_NOTIFICATIONS_EXECUTOR_ENABLED!=="true" || approved.length>25 || approved.some(value=>!/^[A-Za-z0-9_-]{1,128}$/u.test(value)) || !approved.includes(session.vendorId) || !readLearnerNotificationProviderConfiguration()[input.data.channel])
  return NextResponse.json({error:"channel_unavailable"},{status:503,headers});
 try{
  const result=await requestLearnerContactVerification(getDb(),session,courseId,input.data);
  if(result.status!=="challenge_created")return NextResponse.json({status:result.status},{status:{not_found:404,conflict:409,rate_limited:429}[result.status],headers});
  const p=result.preference;
  return NextResponse.json({status:"challenge_queued",challenge:{id:result.challenge.id,expiresAt:result.challenge.expiresAt},preference:{channel:p.channel,enabled:p.enabled,revision:p.revision,destinationVerifiedAt:p.destinationVerifiedAt}},{status:202,headers});
 }catch{return NextResponse.json({error:"verification_unavailable"},{status:503,headers});}
}
