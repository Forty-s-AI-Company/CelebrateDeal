import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { lineUserIdHash } from "@/lib/line-credentials";

const Envelope = z.object({ events: z.array(z.unknown()).max(1000) });
const ConsentEvent = z.object({
  type: z.enum(["follow", "unfollow"]),
  timestamp: z.number().int().positive().max(8_640_000_000_000_000),
  source: z.object({ type: z.literal("user"), userId: z.string().regex(/^U[0-9a-f]{32}$/u) }),
});

/** Call only after exact raw-body signature verification for this tenant. */
export async function applyVerifiedLineWebhookEvents(
  db: Pick<PrismaClient, "lineUserIdentity">,
  vendorId: string,
  rawBody: string,
  now = new Date(),
  accountId?: string,
) {
  // A verified signature still needs an explicit account boundary.
  if (!accountId) return { status: "invalid_payload" as const };
  let body: unknown;
  try { body = JSON.parse(rawBody); } catch { return { status: "invalid_payload" as const }; }
  const envelope = Envelope.safeParse(body);
  if (!envelope.success) return { status: "invalid_payload" as const };

  const events = envelope.data.events.map(value => ConsentEvent.safeParse(value));
  // Provider and server clocks can differ. Do not acknowledge a future unfollow
  // and lose it, or clamp its time and break replay protection after re-consent.
  // A non-2xx response asks the configured provider redelivery to retry later.
  if (events.some(event => event.success && event.data.type === "unfollow" && event.data.timestamp > now.getTime())) {
    return { status: "retry_later" as const };
  }

  for (const event of events) {
    if (!event.success) continue;
    // Adding/unblocking an account cannot restore a revoked registration binding.
    // The existing verified OAuth binding flow is required to grant it again.
    if (event.data.type === "follow") continue;
    const occurredAt = new Date(event.data.timestamp);
    // This conditional update is idempotent. Late redelivery cannot revoke an
    // explicit binding renewed after the original event; no provider ID is stored.
    await db.lineUserIdentity.updateMany({
      where: {
        vendorId,
        lineOfficialAccountId: accountId,
        lineUserIdHash: lineUserIdHash(vendorId, event.data.source.userId),
        revokedAt: null,
        linkedAt: { lte: occurredAt },
      },
      data: { revokedAt: occurredAt },
    });
  }
  return { status: "accepted" as const };
}
