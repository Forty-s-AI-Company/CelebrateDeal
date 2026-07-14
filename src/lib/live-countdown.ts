export type LiveCountdownInput = Date | string | null | undefined;

function toTimestamp(value: LiveCountdownInput) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") return Date.parse(value);
  return Number.NaN;
}

/**
 * Formats a live's remaining time from two explicit inputs so the result is
 * deterministic for server rendering and unit tests.
 */
export function formatLiveCountdown(scheduledAt: LiveCountdownInput, now: LiveCountdownInput) {
  const scheduledAtMs = toTimestamp(scheduledAt);
  const nowMs = toTimestamp(now);

  if (!Number.isFinite(scheduledAtMs) || !Number.isFinite(nowMs)) return null;

  const remainingMs = scheduledAtMs - nowMs;
  if (remainingMs <= 0) return "已開始";

  const remainingMinutes = Math.ceil(remainingMs / (1000 * 60));
  const days = Math.floor(remainingMinutes / (24 * 60));
  const hours = Math.floor((remainingMinutes % (24 * 60)) / 60);
  const minutes = remainingMinutes % 60;
  const parts = [
    days > 0 ? `${days} 天` : null,
    hours > 0 ? `${hours} 小時` : null,
    minutes > 0 ? `${minutes} 分鐘` : null,
  ].filter((part): part is string => part !== null);

  return parts.join(" ");
}
