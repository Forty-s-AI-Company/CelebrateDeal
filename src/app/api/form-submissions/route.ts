import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { readJsonBody, requireSameOriginRequest } from "@/lib/api-security";
import { getDb } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";

const SubmissionPayload = z.object({
  formId: z.string().min(1),
  liveId: z.string().nullable().optional(),
  payload: z.record(z.string(), z.unknown()),
  referralCode: z.string().nullable().optional(),
  redirectTo: z.string().optional(),
});

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  const isNativeFormPost = contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data");
  const sameOrigin = requireSameOriginRequest(request, { requireClientHeader: !isNativeFormPost });
  if (sameOrigin) return sameOrigin;

  const limited = await checkRateLimit(request, "form-submissions", 10, 60_000);
  if (limited) return limited;

  const parsed = SubmissionPayload.safeParse(isNativeFormPost ? await nativeFormPayload(request) : await readJsonBody(request));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const name = String(parsed.data.payload.name ?? "").trim();
  const email = String(parsed.data.payload.email ?? "").trim();
  const phone = parsed.data.payload.phone ? String(parsed.data.payload.phone).trim() : null;

  if (!name || !email) {
    return NextResponse.json({ error: "Name and email are required" }, { status: 400 });
  }

  const form = await getDb().registrationForm.findUnique({ where: { id: parsed.data.formId } });
  if (!form || !form.isActive) {
    return NextResponse.json({ error: "Form not found" }, { status: 404 });
  }

  if (parsed.data.liveId) {
    const live = await getDb().live.findFirst({
      where: { id: parsed.data.liveId, vendorId: form.vendorId },
      select: { id: true },
    });
    if (!live) {
      return NextResponse.json({ error: "Live not found" }, { status: 404 });
    }
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

  await getDb().formSubmission.create({
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

  if (parsed.data.liveId) {
    await getDb().analyticsEvent.create({
      data: {
        vendorId: form.vendorId,
        liveId: parsed.data.liveId,
        visitorId: email,
        eventType: "lead_submit",
        payload: { formId: parsed.data.formId, ref: parsed.data.referralCode ?? null },
      },
    });
  }

  if (parsed.data.referralCode) {
    await getDb().affiliateClick.updateMany({
      where: {
        vendorId: form.vendorId,
        referralCode: parsed.data.referralCode.toUpperCase(),
        convertedAt: null,
      },
      data: { convertedAt: new Date() },
    });
  }

  if (isNativeFormPost && parsed.data.redirectTo && isSameOriginRedirect(parsed.data.redirectTo, request.url)) {
    const redirectUrl = new URL(parsed.data.redirectTo, request.url);
    redirectUrl.searchParams.set("submitted", "1");
    return NextResponse.redirect(redirectUrl, { status: 303 });
  }

  return NextResponse.json({ ok: true });
}

function isSameOriginRedirect(redirectTo: string, requestUrl: string) {
  try {
    return redirectTo.startsWith("/")
      && new URL(redirectTo, requestUrl).origin === new URL(requestUrl).origin;
  } catch {
    return false;
  }
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
