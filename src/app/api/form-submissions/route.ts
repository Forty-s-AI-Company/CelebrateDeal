import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { requireSameOriginRequest } from "@/lib/api-security";
import { getDb } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { resolveRequestAttribution } from "@/lib/attribution";
import { enqueueRegistrationConfirmation } from "@/lib/notifications";

const SubmissionPayload = z.object({
  formId: z.string().min(1),
  liveId: z.string().nullable().optional(),
  payload: z.record(z.string(), z.unknown()),
  redirectTo: z.string().optional(),
});

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  const isNativeFormPost = contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data");
  const sameOrigin = requireSameOriginRequest(request, { requireClientHeader: !isNativeFormPost });
  if (sameOrigin) return sameOrigin;

  const limited = await checkRateLimit(request, "form-submissions", 10, 60_000);
  if (limited) return limited;

  const parsed = SubmissionPayload.safeParse(isNativeFormPost ? await nativeFormPayload(request) : await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const name = String(parsed.data.payload.name ?? "").trim();
  const email = String(parsed.data.payload.email ?? "").trim();
  const phone = parsed.data.payload.phone ? String(parsed.data.payload.phone).trim() : null;

  if (!name || !z.email().safeParse(email).success) {
    return NextResponse.json({ error: "Name and email are required" }, { status: 400 });
  }

  const form = await getDb().registrationForm.findUnique({ where: { id: parsed.data.formId } });
  if (!form || !form.isActive) {
    return NextResponse.json({ error: "Form not found" }, { status: 404 });
  }

  const live = parsed.data.liveId
    ? await getDb().live.findFirst({
      where: { id: parsed.data.liveId, vendorId: form.vendorId },
      select: { id: true, title: true, messageTemplateId: true },
    })
    : null;
  if (parsed.data.liveId && !live) {
      return NextResponse.json({ error: "Live not found" }, { status: 404 });
  }

  const blocked = await getDb().blacklist.findFirst({
    where: {
      vendorId: form.vendorId,
      isActive: true,
      OR: [
        { identifierType: "email", identifier: email },
        ...(phone ? [{ identifierType: "phone", identifier: phone }] : []),
      ],
    },
  });

  if (blocked) {
    return NextResponse.json({ error: "Submission blocked" }, { status: 403 });
  }

  const attribution = await resolveRequestAttribution(request, form.vendorId);

  await getDb().$transaction(async (tx) => {
    const submission = await tx.formSubmission.create({
      data: {
        formId: parsed.data.formId,
        liveId: parsed.data.liveId ?? null,
        name,
        email,
        phone,
        source: parsed.data.liveId ? "live" : "form",
        answers: parsed.data.payload as Prisma.InputJsonValue,
      },
    });

    if (live) {
      await tx.analyticsEvent.create({
        data: {
          vendorId: form.vendorId,
          liveId: live.id,
          visitorId: email,
          eventType: "lead_submit",
          payload: { formId: parsed.data.formId, ref: attribution?.affiliate.code ?? null },
        },
      });
    }

    if (attribution) {
      await tx.affiliateClick.updateMany({
        where: { id: attribution.id, vendorId: form.vendorId, leadAt: null },
        data: { leadAt: new Date() },
      });
    }

    await enqueueRegistrationConfirmation(tx, {
      vendorId: form.vendorId,
      submissionId: submission.id,
      recipient: email,
      name,
      liveTitle: live?.title,
      preferredTemplateId: live?.messageTemplateId,
    });
  });

  if (isNativeFormPost && parsed.data.redirectTo) {
    const redirectUrl = new URL(parsed.data.redirectTo, request.url);
    redirectUrl.searchParams.set("submitted", "1");
    return NextResponse.redirect(redirectUrl, { status: 303 });
  }

  return NextResponse.json({ ok: true });
}

async function nativeFormPayload(request: Request) {
  const formData = await request.formData();
  const reserved = new Set(["formId", "liveId", "referralCode", "redirectTo"]);
  const payload: Record<string, unknown> = {};

  for (const [key, value] of formData.entries()) {
    if (!reserved.has(key)) {
      payload[key] = typeof value === "string" ? value : value.name;
    }
  }

  const liveId = formData.get("liveId");
  const referralCode = formData.get("referralCode");
  const redirectTo = formData.get("redirectTo");
  return {
    formId: String(formData.get("formId") ?? ""),
    liveId: typeof liveId === "string" && liveId ? liveId : null,
    payload,
    referralCode: typeof referralCode === "string" && referralCode ? referralCode : null,
    redirectTo: typeof redirectTo === "string" && redirectTo.startsWith("/") ? redirectTo : undefined,
  };
}
