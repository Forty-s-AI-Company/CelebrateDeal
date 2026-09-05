import { createHmac } from "node:crypto";
import { z } from "zod";
import { decryptSensitiveValue, deriveSensitiveDataKey, encryptSensitiveValue } from "@/lib/sensitive-data";

const lineIdentifier = z.string().trim().min(1).max(128);
const lineSecret = z.string().trim().min(16).max(512);
const lineAccessToken = z.string().trim().min(32).max(4_096);

const LineOfficialAccountCredentialsSchema = z.object({
  messagingChannelId: lineIdentifier,
  messagingChannelSecret: lineSecret,
  messagingAccessToken: lineAccessToken,
  loginChannelId: z.union([lineIdentifier, z.literal("")]).optional(),
  loginChannelSecret: z.union([lineSecret, z.literal("")]).optional(),
}).strict().superRefine((value, context) => {
  if (Boolean(value.loginChannelId) !== Boolean(value.loginChannelSecret)) {
    context.addIssue({
      code: "custom",
      message: "LINE Login Channel ID 與 Secret 必須一起提供。",
      path: [value.loginChannelId ? "loginChannelSecret" : "loginChannelId"],
    });
  }
});

export type LineOfficialAccountCredentials = {
  messagingChannelId: string;
  messagingChannelSecret: string;
  messagingAccessToken: string;
  loginChannelId: string | null;
  loginChannelSecret: string | null;
};

export type ProtectedLineOfficialAccountCredentials = {
  messagingChannelIdEncrypted: string;
  messagingChannelSecretEncrypted: string;
  messagingAccessTokenEncrypted: string;
  loginChannelIdEncrypted: string | null;
  loginChannelSecretEncrypted: string | null;
};

function credentialPurpose(vendorId: string, field: keyof LineOfficialAccountCredentials) {
  if (!vendorId.trim()) throw new Error("LINE credential vendor is required.");
  return `line-official-account:${vendorId}:${field}`;
}

export function parseLineOfficialAccountCredentials(input: unknown) {
  const parsed = LineOfficialAccountCredentialsSchema.safeParse(input);
  if (!parsed.success) return { success: false as const, errors: parsed.error.flatten().fieldErrors };
  return {
    success: true as const,
    data: {
      messagingChannelId: parsed.data.messagingChannelId,
      messagingChannelSecret: parsed.data.messagingChannelSecret,
      messagingAccessToken: parsed.data.messagingAccessToken,
      loginChannelId: parsed.data.loginChannelId || null,
      loginChannelSecret: parsed.data.loginChannelSecret || null,
    } satisfies LineOfficialAccountCredentials,
  };
}

/** Encrypt every provider credential under a tenant and field-specific AES-GCM key. */
export function protectLineOfficialAccountCredentials(
  vendorId: string,
  credentials: LineOfficialAccountCredentials,
): ProtectedLineOfficialAccountCredentials {
  return {
    messagingChannelIdEncrypted: encryptSensitiveValue(
      credentials.messagingChannelId,
      credentialPurpose(vendorId, "messagingChannelId"),
    ),
    messagingChannelSecretEncrypted: encryptSensitiveValue(
      credentials.messagingChannelSecret,
      credentialPurpose(vendorId, "messagingChannelSecret"),
    ),
    messagingAccessTokenEncrypted: encryptSensitiveValue(
      credentials.messagingAccessToken,
      credentialPurpose(vendorId, "messagingAccessToken"),
    ),
    loginChannelIdEncrypted: credentials.loginChannelId
      ? encryptSensitiveValue(credentials.loginChannelId, credentialPurpose(vendorId, "loginChannelId"))
      : null,
    loginChannelSecretEncrypted: credentials.loginChannelSecret
      ? encryptSensitiveValue(credentials.loginChannelSecret, credentialPurpose(vendorId, "loginChannelSecret"))
      : null,
  };
}

export function unprotectLineOfficialAccountCredentials(
  vendorId: string,
  protectedCredentials: ProtectedLineOfficialAccountCredentials,
): LineOfficialAccountCredentials {
  return {
    messagingChannelId: decryptSensitiveValue(
      protectedCredentials.messagingChannelIdEncrypted,
      credentialPurpose(vendorId, "messagingChannelId"),
    ),
    messagingChannelSecret: decryptSensitiveValue(
      protectedCredentials.messagingChannelSecretEncrypted,
      credentialPurpose(vendorId, "messagingChannelSecret"),
    ),
    messagingAccessToken: decryptSensitiveValue(
      protectedCredentials.messagingAccessTokenEncrypted,
      credentialPurpose(vendorId, "messagingAccessToken"),
    ),
    loginChannelId: protectedCredentials.loginChannelIdEncrypted
      ? decryptSensitiveValue(protectedCredentials.loginChannelIdEncrypted, credentialPurpose(vendorId, "loginChannelId"))
      : null,
    loginChannelSecret: protectedCredentials.loginChannelSecretEncrypted
      ? decryptSensitiveValue(protectedCredentials.loginChannelSecretEncrypted, credentialPurpose(vendorId, "loginChannelSecret"))
      : null,
  };
}

/** Keyed lookup hash prevents provider identifiers from becoming an offline enumeration oracle. */
export function lineUserIdHash(vendorId: string, lineUserId: string) {
  if (!vendorId.trim() || !lineUserId.trim()) throw new Error("LINE identity scope is required.");
  return createHmac("sha256", deriveSensitiveDataKey(`line-user-lookup:${vendorId}`))
    .update(lineUserId.trim())
    .digest("hex");
}

export function protectLineProfileValue(vendorId: string, field: "userId" | "displayName" | "pictureUrl", value: string) {
  return encryptSensitiveValue(value.trim(), `line-profile:${vendorId}:${field}`);
}

export function unprotectLineProfileValue(vendorId: string, field: "userId" | "displayName" | "pictureUrl", value: string) {
  return decryptSensitiveValue(value, `line-profile:${vendorId}:${field}`);
}
