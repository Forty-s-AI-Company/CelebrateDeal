"use server";

import { Prisma } from "@prisma/client";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import {
  resolveBuyerSupportGrant,
} from "@/lib/buyer-support-access";
import {
  addBuyerSupportReply,
  createBuyerSupportCase,
  SUPPORT_CASE_CATEGORIES,
} from "@/lib/support-case-domain";
import { assertServerActionSecurity } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import { checkRateLimit, getRateLimitProviderStatus } from "@/lib/rate-limit";

const Identifier = z.string().trim().min(1).max(160).regex(/^[A-Za-z0-9_-]+$/u);
const RequestKey = z.string().uuid();
const Category = z.enum(SUPPORT_CASE_CATEGORIES);

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function revision(formData: FormData) {
  const value = text(formData, "revision");
  if (!/^\d+$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function requestPath(caseId?: string, query?: string) {
  const path = caseId ? `/support/requests/${encodeURIComponent(caseId)}` : "/support/requests";
  return query ? `${path}?${query}` : path;
}

async function publicRequest() {
  const headerStore = await headers();
  const host = headerStore.get("host") ?? "localhost";
  const proto = host.includes("localhost") || host.startsWith("127.") ? "http" : "https";
  const forwardedFor = headerStore.get("x-forwarded-for");
  const cloudflareIp = headerStore.get("cf-connecting-ip");
  return new Request(`${proto}://${host}/support/requests`, {
    headers: {
      ...(forwardedFor ? { "x-forwarded-for": forwardedFor } : {}),
      ...(cloudflareIp ? { "cf-connecting-ip": cloudflareIp } : {}),
    },
  });
}

async function allowPublicSupportMutation(grantId: string) {
  const provider = getRateLimitProviderStatus();
  if (process.env.NODE_ENV === "production" && (!provider.durable || !provider.configured)) return false;
  const request = await publicRequest();
  const [globalLimit, grantLimit] = await Promise.all([
    checkRateLimit(request, "buyer-support-global", 30, 60_000),
    checkRateLimit(request, `buyer-support-grant:${grantId}`, 10, 60_000),
  ]);
  return !globalLimit && !grantLimit;
}

export async function createBuyerSupportCaseAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const grantId = Identifier.safeParse(text(formData, "grantId"));
  const intakeKey = RequestKey.safeParse(text(formData, "intakeKey"));
  const category = Category.safeParse(text(formData, "category"));
  const summary = text(formData, "summary");
  if (
    !grantId.success
    || !intakeKey.success
    || !category.success
    || summary.length < 1
    || summary.length > 4_000
    || !await allowPublicSupportMutation(grantId.success ? grantId.data : "invalid")
  ) {
    redirect(requestPath(undefined, "error=unavailable"));
  }

  const cookieStore = await cookies();
  const resolved = await resolveBuyerSupportGrant(getDb(), cookieStore, grantId.data);
  if (!resolved) redirect(requestPath(undefined, "error=unavailable"));

  let supportCaseId: string;
  try {
    supportCaseId = await getDb().$transaction(async (tx) => {
      const created = await createBuyerSupportCase(tx, {
        grantId: resolved.id,
        intakeKey: intakeKey.data,
        category: category.data,
        summary,
      });
      // Keep the already validated HttpOnly capability stable across the
      // mutation. Rotating it here would permanently lock out the buyer when
      // the database commit succeeds but the redirect/Set-Cookie is lost.
      return created.supportCase.id;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch {
    redirect(requestPath(undefined, "error=unavailable"));
  }
  redirect(requestPath(supportCaseId, "updated=created"));
}

export async function addBuyerSupportReplyAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const grantId = Identifier.safeParse(text(formData, "grantId"));
  const supportCaseId = Identifier.safeParse(text(formData, "supportCaseId"));
  const expectedRevision = revision(formData);
  const dedupKey = RequestKey.safeParse(text(formData, "dedupKey"));
  const message = text(formData, "message");
  if (
    !grantId.success
    || !supportCaseId.success
    || expectedRevision === null
    || !dedupKey.success
    || message.length < 1
    || message.length > 4_000
    || !await allowPublicSupportMutation(grantId.success ? grantId.data : "invalid")
  ) {
    redirect(requestPath(undefined, "error=unavailable"));
  }

  const cookieStore = await cookies();
  const resolved = await resolveBuyerSupportGrant(getDb(), cookieStore, grantId.data);
  if (!resolved) redirect(requestPath(undefined, "error=unavailable"));

  try {
    await getDb().$transaction(async (tx) => {
      await addBuyerSupportReply(tx, {
        grantId: resolved.id,
        supportCaseId: supportCaseId.data,
        expectedRevision,
        dedupKey: dedupKey.data,
        message,
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch {
    redirect(requestPath(undefined, "error=unavailable"));
  }
  redirect(requestPath(supportCaseId.data, "updated=reply"));
}
