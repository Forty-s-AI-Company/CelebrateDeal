import { auditSnapshot, writeAuditLog } from "@/lib/audit";
import { requireVendorManagerContext } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { buildLiveChatExportRows, liveChatRowsToCsv, realViewerMessageWhere, scheduledMessageEventWhere } from "@/lib/live-chat-analytics";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { auth, vendor } = await requireVendorManagerContext();
  const { id } = await params;
  const db = getDb();
  const live = await db.live.findFirst({
    where: { id, vendorId: vendor.id },
    select: {
      id: true,
      scheduledAt: true,
      interactionScript: { select: { id: true, vendorId: true, status: true } },
    },
  });
  if (!live) return new Response(null, { status: 404, headers: { "Cache-Control": "private, no-store" } });

  const validScriptId = live.interactionScript?.vendorId === vendor.id && live.interactionScript.status === "published"
    ? live.interactionScript.id
    : null;
  const [viewerMessages, scheduledMessages] = await Promise.all([
    db.liveChatMessage.findMany({
      where: realViewerMessageWhere({ vendorId: vendor.id, liveId: live.id }),
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, liveId: true, authorName: true, body: true, createdAt: true },
    }),
    validScriptId
      ? db.interactionEvent.findMany({
          where: scheduledMessageEventWhere({ vendorId: vendor.id, scriptId: validScriptId }),
          orderBy: [{ triggerSec: "asc" }, { id: "asc" }],
          select: { id: true, triggerSec: true, message: true, role: { select: { name: true } } },
        })
      : Promise.resolve([]),
  ]);
  const rows = buildLiveChatExportRows({ liveId: live.id, scheduledAt: live.scheduledAt, viewerMessages, scheduledMessages });
  const viewerCount = rows.filter((row) => row.source === "viewer").length;
  const scheduledCount = rows.length - viewerCount;

  await writeAuditLog({
    vendorId: vendor.id,
    actorId: auth.user.id,
    actorLabel: auth.member?.role ?? "manager",
    action: "download_live_chat_csv",
    targetType: "Live",
    targetId: live.id,
    after: auditSnapshot({ viewerCount, scheduledCount }),
  });

  return new Response(`\uFEFF${liveChatRowsToCsv(rows)}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="live-${live.id}-messages.csv"`,
      "Cache-Control": "private, no-store, max-age=0",
      "Pragma": "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
