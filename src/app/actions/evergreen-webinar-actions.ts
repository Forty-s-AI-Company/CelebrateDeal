"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireVendorManagerContext } from "@/lib/auth";
import { auditSnapshot, writeAuditLog } from "@/lib/audit";
import { assertServerActionSecurity } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import { parseZonedDateTimeLocal } from "@/lib/zoned-date-time";

const LIVE_ID = z.string().trim().min(1).max(128);
const DAILY_TIME = /^([01]\d|2[0-3]):[0-5]\d$/u;
const MAX_VIDEO_SECONDS = 24 * 60 * 60;
const PREVIEW_RATES = [0.5, 1, 1.25, 1.5, 2] as const;

const EvergreenSettingsInput = z.object({
  liveId: LIVE_ID,
  isEvergreen: z.boolean(),
  scheduleMode: z.enum(["just_in_time", "recurring_daily", "on_demand"]),
  intervalMinutes: z.union([z.literal(5), z.literal(15), z.literal(30)]),
  dailyTimes: z.array(z.string().regex(DAILY_TIME)).max(24),
  sessionStartAt: z.string().max(32),
  pitchAtSeconds: z.number().int().min(0).max(MAX_VIDEO_SECONDS).nullable(),
  consultationAtSeconds: z.number().int().min(0).max(MAX_VIDEO_SECONDS).nullable(),
  previewEnabled: z.boolean(),
  previewRate: z.union([
    z.literal(PREVIEW_RATES[0]),
    z.literal(PREVIEW_RATES[1]),
    z.literal(PREVIEW_RATES[2]),
    z.literal(PREVIEW_RATES[3]),
    z.literal(PREVIEW_RATES[4]),
  ]),
});

type EvergreenSettings = z.infer<typeof EvergreenSettingsInput>;

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function optionalSeconds(formData: FormData, key: string) {
  const value = text(formData, key);
  if (!value) return null;
  if (!/^\d+$/u.test(value)) return Number.NaN;
  return Number(value);
}

function redirectToSettings(liveId: string, error?: string): never {
  const query = error ? `?error=${encodeURIComponent(error)}` : "";
  redirect(`/lives/${encodeURIComponent(liveId)}/edit${query}`);
}

function parseSettings(formData: FormData): EvergreenSettings | null {
  const parsed = EvergreenSettingsInput.safeParse({
    liveId: text(formData, "liveId"),
    isEvergreen: formData.get("isEvergreen") === "on",
    scheduleMode: text(formData, "evergreenScheduleMode"),
    intervalMinutes: Number(text(formData, "evergreenIntervalMinutes")),
    dailyTimes: formData.getAll("evergreenDailyTimes")
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter(Boolean),
    sessionStartAt: text(formData, "evergreenSessionStartAt"),
    pitchAtSeconds: optionalSeconds(formData, "evergreenPitchAtSeconds"),
    consultationAtSeconds: optionalSeconds(formData, "evergreenConsultationAtSeconds"),
    previewEnabled: formData.get("evergreenPreviewEnabled") === "on",
    previewRate: Number(text(formData, "evergreenPreviewRate")),
  });
  if (!parsed.success) return null;

  const dailyTimes = [...new Set(parsed.data.dailyTimes)].sort();
  if (parsed.data.isEvergreen && parsed.data.scheduleMode === "recurring_daily" && dailyTimes.length === 0) return null;
  return { ...parsed.data, dailyTimes };
}

/**
 * Saves vendor-owned Evergreen settings. The Live is looked up with the
 * current vendor ID and the eventual update repeats that qualification, so a
 * forged liveId can never cross the selected tenant boundary.
 */
export async function updateEvergreenWebinarSettingsAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { auth, vendor } = await requireVendorManagerContext();
  const settings = parseSettings(formData);
  if (!settings) redirect("/lives?error=invalid_evergreen_settings");

  const db = getDb();
  const live = await db.live.findFirst({
    where: { id: settings.liveId, vendorId: vendor.id },
    select: {
      id: true,
      slug: true,
      videoId: true,
      video: { select: { durationSec: true } },
    },
  });
  if (!live) redirect("/lives?error=live_not_found");
  if (settings.isEvergreen && !live.videoId) redirectToSettings(live.id, "evergreen_video_required");

  let sessionStartAt: Date | null = null;
  if (settings.isEvergreen && settings.sessionStartAt) {
    try {
      sessionStartAt = parseZonedDateTimeLocal(settings.sessionStartAt, vendor.timezone);
    } catch {
      redirectToSettings(live.id, "invalid_evergreen_schedule");
    }
  }

  const videoDuration = live.video?.durationSec ?? 0;
  for (const seconds of [settings.pitchAtSeconds, settings.consultationAtSeconds]) {
    if (seconds !== null && videoDuration > 0 && seconds > videoDuration) {
      redirectToSettings(live.id, "evergreen_timing_out_of_range");
    }
  }

  const data = settings.isEvergreen
    ? {
        isEvergreen: true,
        evergreenScheduleMode: settings.scheduleMode,
        evergreenIntervalMinutes: settings.intervalMinutes,
        evergreenDailyTimes: settings.scheduleMode === "recurring_daily" ? settings.dailyTimes : [],
        evergreenSessionStartAt: sessionStartAt,
        evergreenPitchAtSeconds: settings.pitchAtSeconds,
        evergreenConsultationAtSeconds: settings.consultationAtSeconds,
        evergreenPreviewEnabled: settings.previewEnabled,
        evergreenPreviewRate: settings.previewEnabled ? settings.previewRate : 1,
      }
    : {
        isEvergreen: false,
        evergreenScheduleMode: "just_in_time",
        evergreenIntervalMinutes: 15,
        evergreenDailyTimes: [],
        evergreenSessionStartAt: null,
        evergreenPitchAtSeconds: null,
        evergreenConsultationAtSeconds: null,
        evergreenPreviewEnabled: false,
        evergreenPreviewRate: 1,
      };

  // The generated Prisma client is refreshed by the repository build after the
  // migration. Keep this narrow boundary while local generated types may lag
  // behind the schema in a shared worktree.
  const result = await (db.live.updateMany as unknown as (args: {
    where: { id: string; vendorId: string };
    data: typeof data;
  }) => Promise<{ count: number }>)({
    where: { id: live.id, vendorId: vendor.id },
    data,
  });
  if (result.count !== 1) redirect("/lives?error=live_not_found");

  await writeAuditLog({
    vendorId: vendor.id,
    actorId: auth.user.id,
    actorLabel: auth.member?.role ?? "vendor_manager",
    action: "evergreen_webinar_settings_updated",
    targetType: "Live",
    targetId: live.id,
    after: auditSnapshot({
      isEvergreen: data.isEvergreen,
      scheduleMode: data.evergreenScheduleMode,
      intervalMinutes: data.evergreenIntervalMinutes,
      dailyTimes: data.evergreenDailyTimes,
      sessionStartAt: data.evergreenSessionStartAt?.toISOString() ?? null,
      pitchAtSeconds: data.evergreenPitchAtSeconds,
      consultationAtSeconds: data.evergreenConsultationAtSeconds,
      previewEnabled: data.evergreenPreviewEnabled,
      previewRate: data.evergreenPreviewRate,
      sourceVideoId: live.videoId,
    }),
  });

  revalidatePath("/lives");
  revalidatePath(`/lives/${live.id}/edit`);
  revalidatePath(`/lives/${live.id}/preview`);
  revalidatePath(`/live/${live.slug}`);
  redirect(`/lives/${encodeURIComponent(live.id)}/edit?notice=evergreen_saved`);
}
