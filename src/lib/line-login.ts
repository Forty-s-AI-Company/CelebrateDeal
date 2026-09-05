import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { getCanonicalAppUrl } from "@/lib/app-url";
import {
  lineUserIdHash,
  protectLineProfileValue,
  unprotectLineOfficialAccountCredentials,
} from "@/lib/line-credentials";
import { decryptSensitiveValue, encryptSensitiveValue } from "@/lib/sensitive-data";

const LINE_AUTHORIZE_URL = "https://access.line.me/oauth2/v2.1/authorize";
const LINE_TOKEN_URL = "https://api.line.me/oauth2/v2.1/token";
const LINE_VERIFY_URL = "https://api.line.me/oauth2/v2.1/verify";
const LINE_LOGIN_TTL_MS = 10 * 60 * 1_000;
const OAUTH_VALUE = /^[A-Za-z0-9_-]{43}$/u;

export const LINE_LOGIN_SUBJECT_TYPES = ["user", "promoter", "buyer_order", "buyer_registration", "login"] as const;
export type LineLoginSubjectType = typeof LINE_LOGIN_SUBJECT_TYPES[number];

type LineLoginDatabase = Pick<PrismaClient, "$transaction" | "lineOfficialAccount" | "lineLoginState" | "lineUserIdentity">;

export type LineLoginProfile = {
  userId: string;
  displayName: string | null;
  pictureUrl: string | null;
};

export interface LineLoginProvider {
  exchangeCode(input: {
    code: string;
    channelId: string;
    channelSecret: string;
    redirectUri: string;
    codeVerifier: string;
    nonce: string;
  }): Promise<LineLoginProfile>;
}

function safeRedirectPath(value: string) {
  return value.startsWith("/") && !value.startsWith("//") && !value.includes("\\") && value.length <= 1_024
    ? value
    : "/dashboard";
}

function sha256Base64Url(value: string) {
  return createHash("sha256").update(value).digest("base64url");
}

function stateHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function verifierPurpose(vendorId: string, stateId: string) {
  return `line-login-state:${vendorId}:${stateId}`;
}

async function jsonRecord(response: Response) {
  if (!response.ok) throw new Error(`LINE Login provider rejected the request (${response.status}).`);
  const value: unknown = await response.json();
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("LINE Login provider returned an invalid response.");
  return value as Record<string, unknown>;
}

export class LineFetchLoginProvider implements LineLoginProvider {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async exchangeCode(input: Parameters<LineLoginProvider["exchangeCode"]>[0]): Promise<LineLoginProfile> {
    const tokenResponse = await this.fetchImpl(LINE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: input.code,
        redirect_uri: input.redirectUri,
        client_id: input.channelId,
        client_secret: input.channelSecret,
        code_verifier: input.codeVerifier,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const token = await jsonRecord(tokenResponse);
    if (typeof token.id_token !== "string" || token.id_token.length > 8_192) {
      throw new Error("LINE Login response is missing an ID token.");
    }

    const verifyResponse = await this.fetchImpl(LINE_VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ id_token: token.id_token, client_id: input.channelId }),
      signal: AbortSignal.timeout(10_000),
    });
    const claims = await jsonRecord(verifyResponse);
    if (
      typeof claims.sub !== "string"
      || claims.sub.length < 1
      || claims.sub.length > 255
      || claims.nonce !== input.nonce
    ) throw new Error("LINE Login identity verification failed.");
    return {
      userId: claims.sub,
      displayName: typeof claims.name === "string" ? claims.name.slice(0, 255) : null,
      pictureUrl: typeof claims.picture === "string" ? claims.picture.slice(0, 2_048) : null,
    };
  }
}

export async function beginLineLogin(
  db: LineLoginDatabase,
  input: { vendorId: string; subjectType: LineLoginSubjectType; subjectId: string; redirectPath: string },
  now = new Date(),
) {
  if (!input.vendorId || !input.subjectId || !LINE_LOGIN_SUBJECT_TYPES.includes(input.subjectType)) {
    throw new Error("Invalid LINE Login subject.");
  }
  const account = await db.lineOfficialAccount.findUnique({ where: { vendorId: input.vendorId } });
  if (!account || account.status !== "active" || !account.loginChannelIdEncrypted || !account.loginChannelSecretEncrypted) {
    throw new Error("LINE Login is not configured.");
  }
  const credentials = unprotectLineOfficialAccountCredentials(input.vendorId, account);
  if (!credentials.loginChannelId || !credentials.loginChannelSecret) throw new Error("LINE Login is not configured.");

  const state = randomBytes(32).toString("base64url");
  const nonce = randomBytes(32).toString("base64url");
  const codeVerifier = randomBytes(32).toString("base64url");
  const stateId = randomUUID();
  await db.lineLoginState.create({
    data: {
      id: stateId,
      vendorId: input.vendorId,
      stateHash: stateHash(state),
      nonceHash: stateHash(nonce),
      codeVerifierEncrypted: encryptSensitiveValue(`${codeVerifier}:${nonce}`, verifierPurpose(input.vendorId, stateId)),
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      redirectPath: safeRedirectPath(input.redirectPath),
      expiresAt: new Date(now.getTime() + LINE_LOGIN_TTL_MS),
    },
  });

  const redirectUri = `${getCanonicalAppUrl()}/api/auth/line/callback`;
  const authorizationUrl = new URL(LINE_AUTHORIZE_URL);
  authorizationUrl.search = new URLSearchParams({
    response_type: "code",
    client_id: credentials.loginChannelId,
    redirect_uri: redirectUri,
    state,
    scope: "openid profile",
    nonce,
    code_challenge: sha256Base64Url(codeVerifier),
    code_challenge_method: "S256",
  }).toString();
  return { authorizationUrl: authorizationUrl.toString() };
}

export async function completeLineLogin(
  db: LineLoginDatabase,
  provider: LineLoginProvider,
  input: { state: string; code: string },
  now = new Date(),
) {
  if (!OAUTH_VALUE.test(input.state) || !input.code || input.code.length > 4_096) throw new Error("Invalid LINE Login callback.");
  const attempt = await db.lineLoginState.findUnique({
    where: { stateHash: stateHash(input.state) },
    include: { vendor: { select: { id: true } } },
  });
  if (!attempt || attempt.consumedAt || attempt.expiresAt <= now) throw new Error("LINE Login callback expired.");
  const account = await db.lineOfficialAccount.findUnique({ where: { vendorId: attempt.vendorId } });
  if (!account || !account.loginChannelIdEncrypted || !account.loginChannelSecretEncrypted) throw new Error("LINE Login is not configured.");
  const credentials = unprotectLineOfficialAccountCredentials(attempt.vendorId, account);
  if (!credentials.loginChannelId || !credentials.loginChannelSecret) throw new Error("LINE Login is not configured.");
  const codeVerifier = decryptSensitiveValue(attempt.codeVerifierEncrypted, verifierPurpose(attempt.vendorId, attempt.id));

  // The nonce plaintext is intentionally not persisted. It is recoverable only
  // from the encrypted verifier envelope's authenticated companion value below.
  // Store it alongside the verifier for callback verification.
  const [verifier, nonce] = codeVerifier.split(":");
  if (!verifier || !nonce || stateHash(nonce) !== attempt.nonceHash) throw new Error("LINE Login state is invalid.");
  const profile = await provider.exchangeCode({
    code: input.code,
    channelId: credentials.loginChannelId,
    channelSecret: credentials.loginChannelSecret,
    redirectUri: `${getCanonicalAppUrl()}/api/auth/line/callback`,
    codeVerifier: verifier,
    nonce,
  });

  return db.$transaction(async (tx) => {
    const consumed = await tx.lineLoginState.updateMany({
      where: { id: attempt.id, consumedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now },
    });
    if (consumed.count !== 1) throw new Error("LINE Login callback already consumed.");
    const lookupHash = lineUserIdHash(attempt.vendorId, profile.userId);
    if (attempt.subjectType === "login") {
      const identity = await tx.lineUserIdentity.findUnique({
        where: { vendorId_lineUserIdHash: { vendorId: attempt.vendorId, lineUserIdHash: lookupHash } },
      });
      if (!identity || identity.revokedAt) throw new Error("LINE Login identity is not linked.");
      return { identity, redirectPath: attempt.redirectPath, login: true as const };
    }
    const identity = await tx.lineUserIdentity.upsert({
      where: {
        vendorId_subjectType_subjectId: {
          vendorId: attempt.vendorId,
          subjectType: attempt.subjectType,
          subjectId: attempt.subjectId,
        },
      },
      create: {
        vendorId: attempt.vendorId,
        subjectType: attempt.subjectType,
        subjectId: attempt.subjectId,
        lineUserIdHash: lookupHash,
        lineUserIdEncrypted: protectLineProfileValue(attempt.vendorId, "userId", profile.userId),
        displayNameEncrypted: profile.displayName ? protectLineProfileValue(attempt.vendorId, "displayName", profile.displayName) : null,
        pictureUrlEncrypted: profile.pictureUrl ? protectLineProfileValue(attempt.vendorId, "pictureUrl", profile.pictureUrl) : null,
        linkedAt: now,
      },
      update: {
        lineUserIdHash: lookupHash,
        lineUserIdEncrypted: protectLineProfileValue(attempt.vendorId, "userId", profile.userId),
        displayNameEncrypted: profile.displayName ? protectLineProfileValue(attempt.vendorId, "displayName", profile.displayName) : null,
        pictureUrlEncrypted: profile.pictureUrl ? protectLineProfileValue(attempt.vendorId, "pictureUrl", profile.pictureUrl) : null,
        linkedAt: now,
        revokedAt: null,
      },
    });
    return { identity, redirectPath: attempt.redirectPath, login: false as const };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
