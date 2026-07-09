import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { getDb } from "@/lib/db";

const SubmissionPayload = z.object({
  formId: z.string().min(1),
  liveId: z.string().nullable().optional(),
  payload: z.record(z.string(), z.unknown()),
  referralCode: z.string().nullable().optional(),
});

export async function POST(request: Request) {
  const parsed = SubmissionPayload.safeParse(await request.json());
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

  return NextResponse.json({ ok: true });
}
