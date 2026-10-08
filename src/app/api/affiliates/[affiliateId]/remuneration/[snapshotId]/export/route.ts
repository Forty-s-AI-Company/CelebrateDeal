import { Prisma } from "@prisma/client";
import { z } from "zod";
import { getCurrentAuth } from "@/lib/auth";
import { readFormDataBody, requireSameOriginRequest } from "@/lib/api-security";
import { CSRF_FIELD_NAME, verifyCsrfToken } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import { BankAccountEncryptionError } from "@/lib/bank-account";
import { AffiliateRemunerationInputError } from "@/lib/affiliate-remuneration";
import { exportAffiliateRemunerationQuote } from "@/lib/affiliate-remuneration-quotes";
import { affiliateRemunerationCsv } from "@/lib/affiliate-remuneration-csv";
const PrivateHeaders = { "Cache-Control": "private, no-store", "CDN-Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const failure = (status: number) => Response.json({ error: "export_unavailable" }, { status, headers: PrivateHeaders });
export async function POST(request: Request, context: { params: Promise<{ affiliateId: string; snapshotId: string }> }) {
  if (requireSameOriginRequest(request, { requireClientHeader: false })) return failure(403);
  const auth = await getCurrentAuth();
  if (!auth?.vendor || (auth.user.mfaFactor && !auth.isMfaVerified)) return failure(401);
  if (!["affiliate_program", "tax_remuneration"].every(feature => auth.vendor!.enabledFeatureModules.includes(feature))) return failure(404);
  const form = await readFormDataBody(request, 4096), token = form?.get(CSRF_FIELD_NAME);
  if (typeof token !== "string" || !await verifyCsrfToken(token)) return failure(403);
  const params = await context.params;
  if (![params.affiliateId, params.snapshotId].every(value => z.string().regex(/^[A-Za-z0-9_-]{1,160}$/u).safeParse(value).success)) return failure(404);
  try {
    const policy = await getDb().merchantAffiliatePayoutPolicy.findUnique({ where: { vendorId: auth.vendor.id }, select: { bankFeeCents: true, enabled: true } });
    if (!policy?.enabled) return failure(409);
    const record = await exportAffiliateRemunerationQuote(getDb(), { userId: auth.user.id }, { vendorId: auth.vendor.id, affiliateId: params.affiliateId }, params.snapshotId, { bankFeeCents: policy.bankFeeCents });
    if (!record) return failure(409);
    // Return only a private attachment. Do not log, cache or publish this data.
    return new Response(affiliateRemunerationCsv(record), { headers: { ...PrivateHeaders, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="affiliate-remuneration-${params.snapshotId}.csv"` } });
  } catch (error) {
    if (error instanceof BankAccountEncryptionError || error instanceof AffiliateRemunerationInputError || (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code))) return failure(409);
    throw error;
  }
}
