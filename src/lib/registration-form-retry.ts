import { createHash, randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { RegistrationAttributionSchema } from "@/lib/registration-attribution";
import { decryptSensitiveValue, encryptSensitiveValue } from "@/lib/sensitive-data";
import { REGISTRATION_FORM_FIELD_KEY, REGISTRATION_FORM_RESERVED_FIELDS } from "@/lib/registration-form-fields";

export const REGISTRATION_RETRY_TTL_MS = 10 * 60_000;
// Hard per-tenant cap, enforced under a tenant-scoped transaction lock so one
// tenant's traffic cannot exhaust another tenant's retry capacity.
export const REGISTRATION_RETRY_MAX_ROWS_PER_VENDOR = 128;
// Soft global bound on live ciphertext rows across all tenants. It is checked
// before and inside the tenant lock; concurrent writers of different tenants
// may overshoot it by at most their concurrency, never by an unbounded amount.
export const REGISTRATION_RETRY_MAX_ROWS = 2_048;
// Distinct from every other pg_advisory_xact_lock namespace in the codebase.
const ADVISORY_LOCK_NAMESPACE = 1760313600;

export function registrationRetrySecureCookies(host: string) {
  if (process.env.NEXT_PUBLIC_APP_URL) {
    try { return new URL(process.env.NEXT_PUBLIC_APP_URL).protocol === "https:"; }
    catch { return true; }
  }
  return !(process.env.NODE_ENV === "development" && /^(localhost|127\.0\.0\.1)(:\d+)?$/u.test(host));
}
export function registrationRetryCookieName(secure: boolean) {
  return secure ? "__Host-celebratedeal_registration_retry" : "celebratedeal_registration_retry";
}
const PURPOSE = "registration-form-retry-v1";
// Worst case: 32 x 2000 characters, all JSON unicode escapes, plus metadata.
const MAX_PAYLOAD_BYTES = 400_000;
// Matches the CHECK constraint in 20261018110000_registration_form_retry_draft.
const MAX_ENVELOPE_CHARS = 4 * Math.ceil(MAX_PAYLOAD_BYTES / 3) + 64;
const capabilityPattern = /^[A-Za-z0-9_-]{43}$/u;
type DraftDatabase = Pick<PrismaClient, "registrationFormRetryDraft">;
const Answers = z.record(z.string().regex(REGISTRATION_FORM_FIELD_KEY), z.string().max(2_000))
  .refine((value) => Object.keys(value).length <= 32 && Object.keys(value).every((key) => !REGISTRATION_FORM_RESERVED_FIELDS.has(key)));
const Draft = z.object({
  formId: z.string().min(1).max(128),
  sourcePath: z.string().max(2_048),
  answers: Answers,
  attribution: RegistrationAttributionSchema.optional(),
  liveId: z.string().max(128).nullable(),
  status: z.union([z.literal(400), z.literal(403), z.literal(404), z.literal(429), z.literal(503)]),
}).strict();
export type RegistrationRetryDraft = z.infer<typeof Draft>;
/** The tenant always comes from the server-loaded form record, never from the request. */
export type RegistrationRetryDraftInput = RegistrationRetryDraft & { vendorId: string };
const VendorId = z.string().min(1).max(128);

// Only plain public registration entry paths; no query string or external URL.
export function registrationRetrySourcePath(value: string): string | null {
  if (value.length > 2_048 || !/^\/(?:form|p|lp)\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)?$/u.test(value)) return null;
  return value;
}
function lookupHash(capability: string) {
  return createHash("sha256").update(capability).digest("hex");
}
export function registrationRetryCookieOptions(secure: boolean) {
  return { httpOnly: true, secure, sameSite: "strict" as const, path: "/", maxAge: REGISTRATION_RETRY_TTL_MS / 1000 };
}

/** Bounded reclaim of expired ciphertext; without traffic, physical deletion time is not guaranteed. */
export async function purgeExpiredRegistrationRetryDrafts(db: DraftDatabase, now = new Date()) {
  const expired = await db.registrationFormRetryDraft.findMany({
    where: { expiresAt: { lte: now } }, orderBy: { expiresAt: "asc" }, take: 100, select: { idHash: true },
  });
  if (!expired.length) return 0;
  const deleted = await db.registrationFormRetryDraft.deleteMany({
    where: { idHash: { in: expired.map((entry) => entry.idHash) }, expiresAt: { lte: now } },
  });
  return deleted.count;
}

/** Callers verify origin and form eligibility first; never logs fields, capability or ciphertext. */
export async function saveRegistrationRetryDraft(db: DraftDatabase & Pick<PrismaClient, "$transaction">, input: RegistrationRetryDraftInput, now = new Date()): Promise<string | null> {
  const { vendorId: rawVendorId, ...draft } = input;
  const vendor = VendorId.safeParse(rawVendorId);
  const parsed = Draft.safeParse(draft);
  if (!vendor.success || !parsed.success || !registrationRetrySourcePath(parsed.data.sourcePath) || !Number.isFinite(now.getTime())) return null;
  const vendorId = vendor.data;
  const expiresAt = new Date(now.getTime() + REGISTRATION_RETRY_TTL_MS);
  const capability = randomBytes(32).toString("base64url");
  const idHash = lookupHash(capability);
  const serialized = JSON.stringify({ ...parsed.data, vendorId, idHash, expiresAt: expiresAt.toISOString() });
  if (Buffer.byteLength(serialized, "utf8") > MAX_PAYLOAD_BYTES) return null;
  try {
    // Reject a full store before queueing on the lock so unstorable requests
    // do not hold pool connections. The capacity guarantee is the in-lock check.
    const active = { expiresAt: { gt: now } };
    if (await db.registrationFormRetryDraft.count({ where: { vendorId, ...active } }) >= REGISTRATION_RETRY_MAX_ROWS_PER_VENDOR) return null;
    if (await db.registrationFormRetryDraft.count({ where: active }) >= REGISTRATION_RETRY_MAX_ROWS) return null;
    // Lookup hash, tenant, form, source and expiry are inside the authenticated
    // ciphertext, so a payload moved to another row fails to read.
    const encryptedPayload = encryptSensitiveValue(serialized, PURPOSE);
    if (encryptedPayload.length > MAX_ENVELOPE_CHARS) return null;
    return await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_NAMESPACE}::int4, hashtext(${vendorId}))`;
      await purgeExpiredRegistrationRetryDrafts(tx, now);
      if (await tx.registrationFormRetryDraft.count({ where: { vendorId } }) >= REGISTRATION_RETRY_MAX_ROWS_PER_VENDOR) return null;
      if (await tx.registrationFormRetryDraft.count({ where: active }) >= REGISTRATION_RETRY_MAX_ROWS) return null;
      // The composite (vendorId, formId) FK rejects a form of another tenant.
      await tx.registrationFormRetryDraft.create({ data: {
        idHash, vendorId, formId: parsed.data.formId, sourcePath: parsed.data.sourcePath, encryptedPayload,
        // Both timestamps come from the same clock, so the expiry CHECK never depends on DB/app skew.
        createdAt: now, expiresAt,
      }, select: { idHash: true } });
      return capability;
    // After waiting on the lock the count must see the previous commit,
    // regardless of the deployment's default isolation level.
    }, { isolationLevel: "ReadCommitted" });
  } catch {
    // Missing encryption configuration or storage failure: never fall back
    // to plaintext, cookies or URLs.
    return null;
  }
}

export async function readRegistrationRetryDraft(db: DraftDatabase, input: {
  capability: string | undefined; formId: string; sourcePath: string;
}, now = new Date()): Promise<RegistrationRetryDraft | null> {
  if (!input.capability || !capabilityPattern.test(input.capability) || !registrationRetrySourcePath(input.sourcePath) || !Number.isFinite(now.getTime())) return null;
  try {
    await purgeExpiredRegistrationRetryDrafts(db, now);
    const idHash = lookupHash(input.capability);
    const stored = await db.registrationFormRetryDraft.findUnique({ where: { idHash } });
    if (!stored || stored.formId !== input.formId || stored.sourcePath !== input.sourcePath) return null;
    if (stored.expiresAt <= now) {
      await db.registrationFormRetryDraft.deleteMany({ where: { idHash, expiresAt: { lte: now } } });
      return null;
    }
    if (stored.encryptedPayload.length > MAX_ENVELOPE_CHARS) return null;
    const envelope = z.object({ idHash: z.string(), vendorId: VendorId, expiresAt: z.string(), ...Draft.shape }).strict()
      .safeParse(JSON.parse(decryptSensitiveValue(stored.encryptedPayload, PURPOSE)));
    if (!envelope.success) return null;
    const value = envelope.data;
    if (value.idHash !== idHash || value.vendorId !== stored.vendorId || value.formId !== input.formId || value.sourcePath !== input.sourcePath || value.expiresAt !== stored.expiresAt.toISOString()) return null;
    // Only refill data reaches the Client Component; never the capability,
    // lookup hash or tenant identifier.
    return { formId: value.formId, sourcePath: value.sourcePath, answers: value.answers, liveId: value.liveId, status: value.status, ...(value.attribution ? { attribution: value.attribution } : {}) };
  } catch {
    return null;
  }
}

/** Called after a successful submission; deleting an unknown capability is a safe no-op. */
export async function deleteRegistrationRetryDraft(db: DraftDatabase, capability: string | undefined): Promise<boolean> {
  if (!capability || !capabilityPattern.test(capability)) return false;
  try {
    await db.registrationFormRetryDraft.deleteMany({ where: { idHash: lookupHash(capability) } });
    return true;
  } catch {
    return false;
  }
}
