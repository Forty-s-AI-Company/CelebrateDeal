import type { PrismaClient } from "@prisma/client";
import { stopMediaSession } from "./live-media-provider";

/** Claim before disconnecting: a renewed lease must never be closed by a stale cleanup scan. */
export async function cleanupMediaSessions(db: PrismaClient, origin: string, scope: { vendorId?: string; liveId?: string } = {}) {
  const now = new Date();
  const sessions = await db.liveMediaSession.findMany({ where: { ...scope, OR: [{ expiresAt: { lte: now } }, { closing: true }] }, take: 20, orderBy: { expiresAt: "asc" } });
  let stopped = 0;
  const disconnect = async (session: typeof sessions[number]) => {
    const claim = await db.liveMediaSession.updateMany({ where: { id: session.id, OR: [{ expiresAt: { lte: now } }, { closing: true }] }, data: { closing: true } });
    if (claim.count !== 1) return;
    try {
      await stopMediaSession(origin, session.resourcePath);
      await db.liveMediaSession.deleteMany({ where: { id: session.id, closing: true } });
      stopped++;
    } catch { /* Keep the closing row so the next sweep can retry safely. */ }
  };
  // At most four network calls at once; an outage cannot consume 100 serial timeouts.
  for (let offset = 0; offset < sessions.length; offset += 4) await Promise.all(sessions.slice(offset, offset + 4).map(disconnect));
  return { scanned: sessions.length, stopped };
}
