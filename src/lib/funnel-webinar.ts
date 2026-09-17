/** 固定場次只保存時程；Live 與表單沿用 LandingPage 外層綁定。 */
export type FunnelWebinarSettings = {
  timezone: string;
  startsAt: string | null;
  endsAt: string | null;
  replayEndsAt: string | null;
};

function validInstant(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)) return false;
  const timestamp = Date.parse(value);
  const canonical = value.includes(".") ? value : value.replace(/Z$/u, ".000Z");
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === canonical;
}

/** 接受未設定日期的草稿，但不容許錯誤時區或逆序日期流入公開 gate。 */
export function parseFunnelWebinarSettings(value: unknown): FunnelWebinarSettings | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const settings = value as Partial<FunnelWebinarSettings>;
  if (typeof settings.timezone !== "string" || settings.timezone.length > 100 || !/^[A-Za-z][A-Za-z0-9_+\-/]*$/u.test(settings.timezone)) return null;
  try { new Intl.DateTimeFormat("en", { timeZone: settings.timezone }).format(0); } catch { return null; }
  if (!validInstant(settings.startsAt) || !validInstant(settings.endsAt) || !validInstant(settings.replayEndsAt)) return null;
  const { startsAt, endsAt, replayEndsAt, timezone } = settings;
  if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) return null;
  if (replayEndsAt && ((endsAt && Date.parse(replayEndsAt) <= Date.parse(endsAt)) || (startsAt && Date.parse(replayEndsAt) <= Date.parse(startsAt)))) return null;
  return { timezone, startsAt, endsAt, replayEndsAt };
}

export type FunnelWebinarState = {
  status: "missing" | "waiting" | "live" | "replay" | "expired";
  missing: string[];
  message: string;
};

/** 時間區間採左閉右開，方便伺服器與預覽共用同一判定。 */
export function getFunnelWebinarState(
  value: unknown,
  resources: { liveId?: string | null; formId?: string | null },
  now: number | Date = Date.now(),
): FunnelWebinarState {
  const settings = parseFunnelWebinarSettings(value);
  const missing: string[] = [];
  if (!settings) missing.push("請設定有效的 Webinar 時區與日期");
  else {
    if (!settings.startsAt) missing.push("請設定開始時間");
    if (!settings.endsAt) missing.push("請設定結束時間");
  }
  if (!resources.liveId?.trim()) missing.push("請綁定播放用 Live");
  if (!resources.formId?.trim()) missing.push("請綁定報名表單");
  const timestamp = now instanceof Date ? now.getTime() : now;
  if (!Number.isFinite(timestamp)) missing.push("無法取得有效的目前時間");
  if (missing.length || !settings?.startsAt || !settings.endsAt) return { status: "missing", missing, message: missing.join("；") };
  if (timestamp < Date.parse(settings.startsAt)) return { status: "waiting", missing: [], message: "活動尚未開始，請於開始時間回來觀看。" };
  if (timestamp < Date.parse(settings.endsAt)) return { status: "live", missing: [], message: "活動進行中，現在可以進入觀看。" };
  if (settings.replayEndsAt && timestamp < Date.parse(settings.replayEndsAt)) return { status: "replay", missing: [], message: "活動已結束，目前開放重播。" };
  return { status: "expired", missing: [], message: "此場活動與重播已結束。" };
}
