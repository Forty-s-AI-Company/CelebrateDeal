import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { automationCustomerKeyHash } from "@/lib/automation-workflow";
import { getDb } from "@/lib/db";
import { DERIVED_KEY_ROTATIONS, decryptWithRotation, encryptWithRotation, issuedBeforeRotation } from "@/lib/derived-key-rotation";
import { deriveSensitiveDataKey } from "@/lib/sensitive-data";

const TOKEN_VERSION = "sp1";
// Rotated after #485. Access tokens (tier 2) live 15 minutes and are one-time
// database capabilities, so old ones simply expire. Session cookies (tier 3)
// live up to 7 days (30 before F-030): new ones use the new key, old ones
// still decrypt until the legacy key's hard stop in derived-key-purposes.ts.
const TOKEN_PURPOSE = DERIVED_KEY_ROTATIONS.studentPortalAccessToken.current;
const SESSION_KEY = DERIVED_KEY_ROTATIONS.studentPortalSession;
const TOKEN_SIGNATURE = /^[A-Za-z0-9_-]{43}$/u;
const TOKEN_PART = /^[A-Za-z0-9_-]{1,1024}$/u;
const IDENTIFIER = /^[A-Za-z0-9_-]{1,128}$/u;
const NONCE = /^[A-Za-z0-9_-]{43}$/u;
// F-030: shortened from 30 days. Revocation is server-side (see `grant` below).
const SESSION_MAX_TTL_SECONDS = 7 * 24 * 60 * 60;
const GRANT = /^[A-Za-z0-9_-]{43}$/u;

export const STUDENT_PORTAL_ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const STUDENT_PORTAL_SESSION_TTL_SECONDS = SESSION_MAX_TTL_SECONDS;
export const STUDENT_PORTAL_SESSION_COOKIE = "celebratedeal_student_portal_session";

export const StudentPortalAccessTokenPurpose = z.enum(["magic_link", "checkout_redirect"]);
export type StudentPortalAccessTokenPurpose = z.infer<typeof StudentPortalAccessTokenPurpose>;

const TokenPayload = z.object({
  version: z.literal(TOKEN_VERSION),
  purpose: StudentPortalAccessTokenPurpose,
  vendorId: z.string().regex(IDENTIFIER),
  customerKeyHash: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
  issuedAt: z.number().int().safe().positive(),
  expiresAt: z.number().int().safe().positive(),
  nonce: z.string().regex(NONCE),
}).strict();

const SessionPayload = z.object({
  version: z.literal(TOKEN_VERSION),
  vendorId: z.string().regex(IDENTIFIER),
  customerKeyHash: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
  issuedAt: z.number().int().safe().positive(),
  expiresAt: z.number().int().safe().positive(),
  // F-030: digest of the consumed magic-link row this session was minted
  // from. Optional only so pre-F-030 cookies still parse; such cookies carry
  // no grant and are refused by getCurrentStudentPortalSession.
  grant: z.string().regex(GRANT).optional(),
}).strict();

const IssueInput = z.object({
  vendorId: z.string().regex(IDENTIFIER),
  email: z.string().trim().toLowerCase().email().max(254),
  purpose: StudentPortalAccessTokenPurpose,
});

type StudentPortalAccessTokenStore = {
  create(args: {
    data: {
      vendorId: string;
      tokenHash: string;
      customerKeyHash: string;
      purpose: StudentPortalAccessTokenPurpose;
      issuedAt: Date;
      expiresAt: Date;
    };
  }): Promise<unknown>;
  updateMany(args: {
    where: {
      vendorId: string;
      tokenHash: string;
      customerKeyHash: string;
      purpose: StudentPortalAccessTokenPurpose;
      issuedAt: Date;
      expiresAt: { gt: Date };
      consumedAt: null;
    };
    data: { consumedAt: Date };
  }): Promise<{ count: number }>;
  findFirst(args: {
    where: { vendorId: string; customerKeyHash: string; tokenHash: string; consumedAt: { not: null } };
    select: { id: true };
  }): Promise<{ id: string } | null>;
  deleteMany(args: {
    where: { vendorId: string; customerKeyHash: string; tokenHash?: string; consumedAt?: { not: null } };
  }): Promise<{ count: number }>;
};

type StudentPortalVendorStore = {
  findFirst(args: {
    where: { id: string; slug: string };
    select: { id: true; slug: true; name: true; logoUrl: true; primaryColor: true };
  }): Promise<{ id: string; slug: string; name: string; logoUrl: string | null; primaryColor: string } | null>;
};

export type StudentPortalTokenDatabase = {
  studentPortalAccessToken: StudentPortalAccessTokenStore;
  vendor: StudentPortalVendorStore;
};

export type StudentPortalAccessTokenClaim = {
  vendorId: string;
  customerKeyHash: string;
  purpose: StudentPortalAccessTokenPurpose;
  issuedAt: Date;
  expiresAt: Date;
};

/** A consumed capability also names the row that later keeps its session alive (F-030). */
export type StudentPortalConsumedAccess = StudentPortalAccessTokenClaim & { grant: string };

export type StudentPortalSession = {
  vendorId: string;
  customerKeyHash: string;
  issuedAt: Date;
  expiresAt: Date;
  grant?: string;
};

function database(): StudentPortalTokenDatabase {
  // The Prisma model is introduced with this feature migration. Keeping this
  // narrow interface also makes the public capability boundary testable.
  return getDb() as unknown as StudentPortalTokenDatabase;
}

function epochSeconds(now: Date) {
  const value = Math.floor(now.getTime() / 1_000);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("Invalid student portal clock.");
  return value;
}

function accessTokenSignature(payload: string) {
  return createHmac("sha256", deriveSensitiveDataKey(TOKEN_PURPOSE))
    .update(`${TOKEN_VERSION}.${payload}`)
    .digest("base64url");
}

function tokenDigest(token: string) {
  return createHash("sha256").update(token).digest("base64url");
}

function tokenPayload(value: Omit<z.infer<typeof TokenPayload>, "version">) {
  const payload = Buffer.from(JSON.stringify({ version: TOKEN_VERSION, ...value }), "utf8").toString("base64url");
  if (!TOKEN_PART.test(payload)) throw new Error("Student portal access token payload is too large.");
  return payload;
}

function constantTimeSignatureMatches(payload: string, suppliedSignature: string) {
  const expected = Buffer.from(accessTokenSignature(payload), "utf8");
  const supplied = Buffer.from(suppliedSignature, "utf8");
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

function asClaim(payload: z.infer<typeof TokenPayload>): StudentPortalAccessTokenClaim {
  return {
    vendorId: payload.vendorId,
    customerKeyHash: payload.customerKeyHash,
    purpose: payload.purpose,
    issuedAt: new Date(payload.issuedAt * 1_000),
    expiresAt: new Date(payload.expiresAt * 1_000),
  };
}

/** Verifies the HMAC capability before any database state is consulted. */
export function verifyStudentPortalAccessToken(input: {
  token: string;
  expectedPurpose?: StudentPortalAccessTokenPurpose;
  now?: Date;
}): StudentPortalAccessTokenClaim | null {
  if (typeof input.token !== "string" || input.token.length === 0 || input.token.length > 1_200) return null;
  const [version, payloadPart, suppliedSignature, extra] = input.token.split(".");
  if (
    version !== TOKEN_VERSION
    || !payloadPart
    || !TOKEN_PART.test(payloadPart)
    || !suppliedSignature
    || !TOKEN_SIGNATURE.test(suppliedSignature)
    || extra !== undefined
    || !constantTimeSignatureMatches(payloadPart, suppliedSignature)
  ) return null;

  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const parsed = TokenPayload.safeParse(decoded);
  if (!parsed.success || (input.expectedPurpose && parsed.data.purpose !== input.expectedPurpose)) return null;

  const nowSeconds = epochSeconds(input.now ?? new Date());
  if (
    parsed.data.issuedAt > nowSeconds
    || parsed.data.expiresAt <= nowSeconds
    || parsed.data.expiresAt - parsed.data.issuedAt !== STUDENT_PORTAL_ACCESS_TOKEN_TTL_SECONDS
  ) return null;
  return asClaim(parsed.data);
}

/**
 * Issues a signed, 15-minute capability and persists only its digest. The
 * matching `consume` call below owns the one-time state transition.
 */
export async function createStudentPortalAccessToken(
  db: { studentPortalAccessToken: Pick<StudentPortalAccessTokenStore, "create" | "updateMany"> },
  input: { vendorId: string; email: string; purpose: StudentPortalAccessTokenPurpose; now?: Date },
) {
  const parsed = IssueInput.parse(input);
  const now = input.now ?? new Date();
  const issuedAtSeconds = epochSeconds(now);
  const expiresAtSeconds = issuedAtSeconds + STUDENT_PORTAL_ACCESS_TOKEN_TTL_SECONDS;
  const customerKeyHash = automationCustomerKeyHash(parsed.vendorId, parsed.email);
  const payload = tokenPayload({
    purpose: parsed.purpose,
    vendorId: parsed.vendorId,
    customerKeyHash,
    issuedAt: issuedAtSeconds,
    expiresAt: expiresAtSeconds,
    nonce: randomBytes(32).toString("base64url"),
  });
  const token = `${TOKEN_VERSION}.${payload}.${accessTokenSignature(payload)}`;
  const issuedAt = new Date(issuedAtSeconds * 1_000);
  const expiresAt = new Date(expiresAtSeconds * 1_000);

  await db.studentPortalAccessToken.create({
    data: {
      vendorId: parsed.vendorId,
      tokenHash: tokenDigest(token),
      customerKeyHash,
      purpose: parsed.purpose,
      issuedAt,
      expiresAt,
    },
  });
  return token;
}

export async function createStudentPortalMagicLink(input: {
  vendorId: string;
  email: string;
  now?: Date;
}) {
  return createStudentPortalAccessToken(database(), { ...input, purpose: "magic_link" });
}

/** Convenience factory for the checkout-success flow; it cannot issue a login-purpose token. */
export async function createCheckoutStudentPortalAccessToken(input: {
  vendorId: string;
  email: string;
  now?: Date;
}) {
  return createStudentPortalAccessToken(database(), { ...input, purpose: "checkout_redirect" });
}

/**
 * Atomically consumes the database capability after cryptographic validation.
 * `updateMany` deliberately includes every tenant and identity predicate so
 * concurrent requests can transition exactly one row from unconsumed to used.
 */
export async function consumeStudentPortalAccessToken(
  db: { studentPortalAccessToken: Pick<StudentPortalAccessTokenStore, "create" | "updateMany"> },
  input: { token: string; expectedPurpose: StudentPortalAccessTokenPurpose; now?: Date },
): Promise<StudentPortalConsumedAccess | null> {
  const now = input.now ?? new Date();
  const claim = verifyStudentPortalAccessToken({
    token: input.token,
    expectedPurpose: input.expectedPurpose,
    now,
  });
  if (!claim) return null;

  const consumed = await db.studentPortalAccessToken.updateMany({
    where: {
      vendorId: claim.vendorId,
      tokenHash: tokenDigest(input.token),
      customerKeyHash: claim.customerKeyHash,
      purpose: claim.purpose,
      issuedAt: claim.issuedAt,
      expiresAt: { gt: now },
      consumedAt: null,
    },
    data: { consumedAt: now },
  });
  if (consumed.count !== 1) return null;
  return {
    vendorId: claim.vendorId,
    customerKeyHash: claim.customerKeyHash,
    purpose: claim.purpose,
    issuedAt: claim.issuedAt,
    expiresAt: claim.expiresAt,
    grant: tokenDigest(input.token),
  };
}

export async function consumeStudentPortalMagicLink(input: { token: string; now?: Date }) {
  return consumeStudentPortalAccessToken(database(), { ...input, expectedPurpose: "magic_link" });
}

export async function consumeCheckoutStudentPortalAccessToken(input: { token: string; now?: Date }) {
  return consumeStudentPortalAccessToken(database(), { ...input, expectedPurpose: "checkout_redirect" });
}

export function createStudentPortalSessionToken(input: {
  vendorId: string;
  customerKeyHash: string;
  grant?: string;
  now?: Date;
  ttlSeconds?: number;
}) {
  if (
    !IDENTIFIER.test(input.vendorId)
    || !/^[A-Za-z0-9_-]{43}$/u.test(input.customerKeyHash)
    || (input.grant !== undefined && !GRANT.test(input.grant))
  ) {
    throw new Error("Invalid student portal session binding.");
  }
  const ttlSeconds = input.ttlSeconds ?? STUDENT_PORTAL_SESSION_TTL_SECONDS;
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds <= 0 || ttlSeconds > SESSION_MAX_TTL_SECONDS) {
    throw new Error("Invalid student portal session TTL.");
  }
  const issuedAt = epochSeconds(input.now ?? new Date());
  const expiresAt = issuedAt + ttlSeconds;
  return encryptWithRotation(JSON.stringify({
    version: TOKEN_VERSION,
    vendorId: input.vendorId,
    customerKeyHash: input.customerKeyHash,
    issuedAt,
    expiresAt,
    ...(input.grant ? { grant: input.grant } : {}),
  }), SESSION_KEY);
}

function legacySessionIssuedBeforeRotation(plaintext: string) {
  const parsed = SessionPayload.safeParse(JSON.parse(plaintext));
  return parsed.success && issuedBeforeRotation(parsed.data.issuedAt * 1_000);
}

export function readStudentPortalSessionToken(token: string | null | undefined, now = new Date()): StudentPortalSession | null {
  if (!token || token.length > 2_048) return null;
  try {
    // A legacy-key cookie is accepted only if its encrypted issuedAt predates the rotation.
    const parsed = SessionPayload.safeParse(JSON.parse(decryptWithRotation(token, SESSION_KEY, now, legacySessionIssuedBeforeRotation).plaintext));
    if (!parsed.success) return null;
    const nowSeconds = epochSeconds(now);
    if (
      parsed.data.issuedAt > nowSeconds
      || parsed.data.expiresAt <= parsed.data.issuedAt
      || parsed.data.expiresAt <= nowSeconds
      || parsed.data.expiresAt - parsed.data.issuedAt > SESSION_MAX_TTL_SECONDS
    ) return null;
    return {
      vendorId: parsed.data.vendorId,
      customerKeyHash: parsed.data.customerKeyHash,
      issuedAt: new Date(parsed.data.issuedAt * 1_000),
      expiresAt: new Date(parsed.data.expiresAt * 1_000),
      grant: parsed.data.grant,
    };
  } catch {
    return null;
  }
}

/**
 * F-030: a portal session stays valid only while the consumed magic-link row
 * it was minted from still exists for the same tenant and customer. Deleting
 * that row (sign-out, revokeStudentPortalSessions, customer anonymization)
 * revokes the session server-side without a schema change. Any retention job
 * for StudentPortalAccessToken must therefore keep consumed rows for at least
 * the 7-day session lifetime.
 */
export async function isStudentPortalSessionActive(
  db: { studentPortalAccessToken: Pick<StudentPortalAccessTokenStore, "findFirst"> },
  session: StudentPortalSession,
) {
  if (!session.grant || !GRANT.test(session.grant)) return false;
  const row = await db.studentPortalAccessToken.findFirst({
    where: {
      vendorId: session.vendorId,
      customerKeyHash: session.customerKeyHash,
      tokenHash: session.grant,
      consumedAt: { not: null },
    },
    select: { id: true },
  });
  return Boolean(row);
}

/**
 * Ends every portal session (and unused magic link) of one customer at one
 * vendor. Tenant-scoped: the customer key is derived from this vendorId.
 */
export async function revokeStudentPortalSessions(
  db: { studentPortalAccessToken: Pick<StudentPortalAccessTokenStore, "deleteMany"> },
  input: { vendorId: string; email: string },
) {
  const parsed = z.object({ vendorId: z.string().regex(IDENTIFIER), email: z.string().trim().toLowerCase().email().max(254) }).parse(input);
  const { count } = await db.studentPortalAccessToken.deleteMany({
    where: { vendorId: parsed.vendorId, customerKeyHash: automationCustomerKeyHash(parsed.vendorId, parsed.email) },
  });
  return count;
}

export function studentPortalSessionCookieOptions(secure = process.env.NODE_ENV === "production") {
  return {
    httpOnly: true as const,
    sameSite: "lax" as const,
    secure,
    path: "/portal",
    maxAge: STUDENT_PORTAL_SESSION_TTL_SECONDS,
  };
}

/** Deletes the consumed capability row behind one session cookie, bound to its own vendor and customer. */
async function revokeStudentPortalSessionCookie(token: string | undefined) {
  const session = readStudentPortalSessionToken(token);
  if (!session?.grant) return;
  await database().studentPortalAccessToken.deleteMany({
    where: {
      vendorId: session.vendorId,
      customerKeyHash: session.customerKeyHash,
      tokenHash: session.grant,
      consumedAt: { not: null },
    },
  });
}

/**
 * A new sign-in on this browser first revokes the session the cookie being
 * replaced still names (M3), so overwriting a cookie never leaves an older,
 * possibly copied, session alive on the server.
 */
export async function setStudentPortalSessionCookie(session: Pick<StudentPortalConsumedAccess, "vendorId" | "customerKeyHash" | "grant">) {
  const token = createStudentPortalSessionToken({
    vendorId: session.vendorId,
    customerKeyHash: session.customerKeyHash,
    grant: session.grant,
  });
  const store = await cookies();
  const previous = store.get(STUDENT_PORTAL_SESSION_COOKIE)?.value;
  if (previous) await revokeStudentPortalSessionCookie(previous);
  store.set(STUDENT_PORTAL_SESSION_COOKIE, token, studentPortalSessionCookieOptions());
}

/** Sign-out revokes this session server-side; the cookie is removed even if that fails (F-030). */
export async function clearStudentPortalSessionCookie() {
  const store = await cookies();
  try {
    await revokeStudentPortalSessionCookie(store.get(STUDENT_PORTAL_SESSION_COOKIE)?.value);
  } finally {
    store.delete({ name: STUDENT_PORTAL_SESSION_COOKIE, path: "/portal" });
  }
}

export async function getCurrentStudentPortalSession() {
  const token = (await cookies()).get(STUDENT_PORTAL_SESSION_COOKIE)?.value;
  const session = readStudentPortalSessionToken(token);
  if (!session || !await isStudentPortalSessionActive(database(), session)) return null;
  return session;
}

function studentPortalLoginPath(vendorSlug: string) {
  return `/portal/${encodeURIComponent(vendorSlug)}/login`;
}

/** Resolves a session only when its tenant identity also owns the URL slug. */
export async function requireStudentPortalSession(vendorSlug: string) {
  if (!vendorSlug || vendorSlug.length > 120) redirect("/portal");
  const session = await getCurrentStudentPortalSession();
  if (!session) redirect(studentPortalLoginPath(vendorSlug));

  const vendor = await database().vendor.findFirst({
    where: { id: session.vendorId, slug: vendorSlug },
    select: { id: true, slug: true, name: true, logoUrl: true, primaryColor: true },
  });
  if (!vendor) redirect(`${studentPortalLoginPath(vendorSlug)}?error=unauthorized`);
  return { session, vendor };
}
