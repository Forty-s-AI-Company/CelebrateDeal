export const LIVE_CHAT_EXPORT_COLUMNS = [
  "messageId",
  "liveId",
  "actorName",
  "body",
  "source",
  "isSimulated",
  "occurredAt",
] as const;

export type LiveChatExportRow = {
  messageId: string;
  liveId: string;
  actorName: string;
  body: string;
  source: "viewer" | "scheduled";
  isSimulated: boolean;
  occurredAt: string;
};

type ViewerMessageRecord = {
  id: string;
  liveId: string;
  authorName: string;
  body: string;
  createdAt: Date;
};

type ScheduledMessageRecord = {
  id: string;
  triggerSec: number;
  message: string | null;
  role: { name: string } | null;
};

export function realViewerMessageWhere(input: {
  vendorId: string;
  liveId?: string;
  createdAtGte?: Date;
}) {
  return {
    vendorId: input.vendorId,
    ...(input.liveId ? { liveId: input.liveId } : {}),
    source: "viewer",
    isSimulated: false,
    status: "visible",
    formSubmissionId: { not: null },
    roleId: null,
    ...(input.createdAtGte ? { createdAt: { gte: input.createdAtGte } } : {}),
  } as const;
}

export function scheduledMessageEventWhere(input: { vendorId: string; scriptId?: string }) {
  return {
    eventType: { in: ["chat_message", "reminder"] },
    message: { not: null },
    isSimulated: true,
    script: {
      ...(input.scriptId ? { id: input.scriptId } : {}),
      vendorId: input.vendorId,
      status: "published",
    },
    role: {
      is: {
        vendorId: input.vendorId,
        isActive: true,
        isScheduled: true,
      },
    },
  };
}

function scheduledOccurredAt(scheduledAt: Date | null, triggerSec: number) {
  if (!(scheduledAt instanceof Date) || !Number.isFinite(scheduledAt.getTime())) return "";
  if (!Number.isSafeInteger(triggerSec) || triggerSec < 0) return "";
  return new Date(scheduledAt.getTime() + triggerSec * 1_000).toISOString();
}

export function buildLiveChatExportRows(input: {
  liveId: string;
  scheduledAt: Date | null;
  viewerMessages: ViewerMessageRecord[];
  scheduledMessages: ScheduledMessageRecord[];
}): LiveChatExportRow[] {
  const viewerRows: LiveChatExportRow[] = input.viewerMessages.map((message) => ({
    messageId: message.id,
    liveId: message.liveId,
    actorName: message.authorName,
    body: message.body,
    source: "viewer",
    isSimulated: false,
    occurredAt: message.createdAt.toISOString(),
  }));
  const scheduledRows: LiveChatExportRow[] = input.scheduledMessages
    .filter((message) => Boolean(message.message?.trim() && message.role?.name.trim()))
    .map((message) => ({
      messageId: message.id,
      liveId: input.liveId,
      actorName: message.role!.name,
      body: message.message!.trim(),
      source: "scheduled",
      isSimulated: true,
      occurredAt: scheduledOccurredAt(input.scheduledAt, message.triggerSec),
    }));

  return [...viewerRows, ...scheduledRows].sort((left, right) => (
    left.occurredAt.localeCompare(right.occurredAt) || left.source.localeCompare(right.source) || left.messageId.localeCompare(right.messageId)
  ));
}

export function csvCell(value: string | boolean) {
  const raw = String(value);
  // Spreadsheet engines may ignore leading spaces or control whitespace
  // before interpreting a formula, so inspect the first non-whitespace byte.
  const safe = /^\s*[=+\-@]/u.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function liveChatRowsToCsv(rows: LiveChatExportRow[]) {
  const header = LIVE_CHAT_EXPORT_COLUMNS.map(csvCell).join(",");
  const body = rows.map((row) => LIVE_CHAT_EXPORT_COLUMNS.map((column) => csvCell(row[column])).join(","));
  return [header, ...body].join("\n");
}
