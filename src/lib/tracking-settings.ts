import { z } from "zod";
import { getDb } from "@/lib/db";
import { protectFacebookAccessToken } from "@/lib/tracking-credentials";

export const TrackingCredentialInput = z.object({
  expectedRevision: z.number().int().min(0).max(2147483646),
  token: z.string().max(4096).optional(),
  testEventCode: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u).nullable(),
  clearToken: z.boolean(),
}).strict();

export class TrackingConfigurationConflict extends Error {
  constructor() { super("Tracking settings changed; reload before saving."); }
}

/** Caller must derive vendorId from its authenticated tenant, never FormData. */
export async function saveTrackingCredentialConfiguration(vendorId: string, raw: z.infer<typeof TrackingCredentialInput>) {
  const input = TrackingCredentialInput.parse(raw);
  const token = input.token?.trim();
  if (input.clearToken && token) throw new TypeError("Choose one credential operation.");
  const encrypted = token ? protectFacebookAccessToken(vendorId, token) : undefined;
  return getDb().$transaction(async tx => {
    // Creation and the revision check share a transaction: stale creation rolls back.
    await tx.trackingSetting.upsert({ where: { vendorId }, create: { vendorId }, update: {} });
    const updated = await tx.trackingSetting.updateMany({
      where: { vendorId, credentialRevision: input.expectedRevision },
      data: {
        ...(input.clearToken ? { facebookAccessTokenEncrypted: null } : encrypted ? { facebookAccessTokenEncrypted: encrypted } : {}),
        facebookTestEventCode: input.testEventCode,
        credentialRevision: { increment: 1 },
      },
    });
    if (updated.count !== 1) throw new TrackingConfigurationConflict();
    return { revision: input.expectedRevision + 1 };
  });
}
