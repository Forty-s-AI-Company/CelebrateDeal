import { NextResponse } from "next/server";
import { requireSameOriginRequest, readJsonBody } from "@/lib/api-security";
import { verifyCsrfToken } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import { requireStudentPortalSession } from "@/lib/student-portal-auth";
import { requestLearnerContactVerification, LearnerContactEnrollmentInput } from "@/lib/learner-notification-verification";
import { getLearnerNotificationCapabilities } from "@/lib/learner-notification-capabilities";

type Context = { params: Promise<{ vendorSlug: string; courseId: string }> };
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
const courseIdentifier = /^[A-Za-z0-9_-]{1,128}$/u;
const refusedStatus = { not_found: 404, conflict: 409, rate_limited: 429, daily_limit_reached: 429, destination_unsupported: 400 } as const;

/** Browser can request proof only for its current course/session. Provider
 * credentials, destination proof, worker nonce and encrypted payload stay private. */
export async function POST(request: Request, { params }: Context) {
 const boundary=requireSameOriginRequest(request,{requireClientHeader:true});if(boundary)return boundary;
 if(!await verifyCsrfToken(request.headers.get("x-csrf-token")))return NextResponse.json({error:"forbidden"},{status:403,headers});
 const input=LearnerContactEnrollmentInput.safeParse(await readJsonBody(request,4096));
 if(!input.success)return NextResponse.json({error:"invalid_destination"},{status:400,headers});
 const {vendorSlug,courseId}=await params;
 if(!courseIdentifier.test(courseId))return NextResponse.json({error:"not_found"},{status:404,headers});
 const {session}=await requireStudentPortalSession(vendorSlug);
 if(!getLearnerNotificationCapabilities(session.vendorId).availableChannels.includes(input.data.channel))
  return NextResponse.json({error:"channel_unavailable"},{status:503,headers});
 try{
  const result=await requestLearnerContactVerification(getDb(),session,courseId,input.data);
  // daily_limit_reached and destination_unsupported are user-facing codes the
  // settings UI explains; they never reveal another learner's usage.
  if(result.status!=="challenge_created")return NextResponse.json({status:result.status},{status:refusedStatus[result.status],headers});
  const p=result.preference;
  return NextResponse.json({status:"challenge_queued",challenge:{id:result.challenge.id,expiresAt:result.challenge.expiresAt},preference:{channel:p.channel,enabled:p.enabled,revision:p.revision,destinationVerifiedAt:p.destinationVerifiedAt}},{status:202,headers});
 }catch{return NextResponse.json({error:"verification_unavailable"},{status:503,headers});}
}
