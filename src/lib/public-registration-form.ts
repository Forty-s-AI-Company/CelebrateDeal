import type { Prisma } from "@prisma/client";
import { cache } from "react";

import { getDb } from "@/lib/db";
import { parseSafeExternalHttpUrl } from "@/lib/external-url";
import { isExistingLiveVideoReady } from "@/lib/live-video-readiness";
import { parseRegistrationFormFields, type RegistrationFormFieldSpec } from "@/lib/registration-form-fields";

const PUBLIC_REGISTRATION_FORM_SELECT = {
  id: true,
  vendorId: true,
  slug: true,
  headline: true,
  description: true,
  submitLabel: true,
  successMessage: true,
  fields: true,
  heroImageUrl: true,
  backgroundImageUrl: true,
  themeColor: true,
  stickyText: true,
  bodyContent: true,
  notice: true,
  seoTitle: true,
  seoDescription: true,
  maxVisibleSessions: true,
  hideExpiredSessions: true,
  vendor: {
    select: { name: true },
  },
  promoVideo: {
    select: {
      vendorId: true,
      title: true,
      videoUrl: true,
      sourceType: true,
      status: true,
      cloudflareReadyToStream: true,
      cloudflareLiveInputUid: true,
      liveInputStatus: true,
    },
  },
} satisfies Prisma.RegistrationFormSelect;

export type PublicRegistrationSessionVisibilityCandidate = {
  scheduledAt: Date;
  status: string;
};

type SessionCandidate = PublicRegistrationSessionVisibilityCandidate & {
  id: string;
  title: string;
  description: string | null;
  endedAt: Date | null;
};

export type PublicRegistrationSession = {
  id: string;
  title: string;
  description: string | null;
  scheduledAt: string;
  status: "scheduled" | "live" | "ended";
};

export type PublicRegistrationForm = {
  id: string;
  slug: string;
  vendor: { name: string };
  headline: string;
  description: string | null;
  submitLabel: string;
  successMessage: string;
  fields: RegistrationFormFieldSpec[] | null;
  heroImageUrl: string | null;
  backgroundImageUrl: string | null;
  themeColor: string | null;
  stickyText: string | null;
  bodyContent: string | null;
  notice: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  promoVideo: { title: string; videoUrl: string } | null;
  sessions: PublicRegistrationSession[];
};

function safeThemeColor(value: string | null) {
  return value && /^#[0-9A-Fa-f]{6}$/u.test(value) ? value : null;
}

function sessionTimestamp(session: SessionCandidate) {
  return session.endedAt?.getTime() ?? session.scheduledAt.getTime();
}

export function publicRegistrationSessionWhere(formId: string, vendorId: string): Prisma.LiveWhereInput {
  return {
    formId,
    vendorId,
    OR: [
      { status: { in: ["scheduled", "live"] } },
      { status: "ended", replayEnabled: true },
    ],
  };
}

export function isPublicRegistrationSessionVisible(
  session: PublicRegistrationSessionVisibilityCandidate,
  options: { now: Date; hideExpiredSessions: boolean },
) {
  if (session.status !== "scheduled" && session.status !== "live" && session.status !== "ended") return false;
  return !(
    options.hideExpiredSessions
    && session.status === "scheduled"
    && session.scheduledAt < options.now
  );
}

export function hasPublicRegistrationSession(
  sessions: readonly PublicRegistrationSessionVisibilityCandidate[],
  options: { now: Date; hideExpiredSessions: boolean },
) {
  return sessions.some((session) => isPublicRegistrationSessionVisible(session, options));
}

export function selectPublicRegistrationSessions(
  sessions: readonly SessionCandidate[],
  options: {
    now: Date;
    hideExpiredSessions: boolean;
    maxVisibleSessions: number;
  },
) {
  const visible = sessions
    .filter((session) => isPublicRegistrationSessionVisible(session, options))
    .sort((left, right) => {
      const rank = { live: 0, scheduled: 1, ended: 2 } as const;
      const rankDifference = rank[left.status as keyof typeof rank] - rank[right.status as keyof typeof rank];
      if (rankDifference !== 0) return rankDifference;

      if (left.status === "ended" && right.status === "ended") {
        return sessionTimestamp(right) - sessionTimestamp(left) || left.id.localeCompare(right.id);
      }
      return left.scheduledAt.getTime() - right.scheduledAt.getTime() || left.id.localeCompare(right.id);
    })
    .map((session) => ({
      id: session.id,
      title: session.title,
      description: session.description,
      scheduledAt: session.scheduledAt.toISOString(),
      status: session.status as PublicRegistrationSession["status"],
    }));

  return options.maxVisibleSessions > 0
    ? visible.slice(0, options.maxVisibleSessions)
    : visible;
}

function publicFormFromRecord(
  form: Prisma.RegistrationFormGetPayload<{ select: typeof PUBLIC_REGISTRATION_FORM_SELECT }>,
  sessions: readonly SessionCandidate[],
  now: Date,
): PublicRegistrationForm {
  const parsedFields = parseRegistrationFormFields(form.fields);
  const promoVideo = form.promoVideo
    && form.promoVideo.vendorId === form.vendorId
    && isExistingLiveVideoReady(form.promoVideo)
    ? parseSafeExternalHttpUrl(form.promoVideo.videoUrl)
    : null;

  return {
    id: form.id,
    slug: form.slug,
    vendor: form.vendor,
    headline: form.headline,
    description: form.description,
    submitLabel: form.submitLabel,
    successMessage: form.successMessage,
    fields: parsedFields.success ? parsedFields.data : null,
    heroImageUrl: parseSafeExternalHttpUrl(form.heroImageUrl),
    backgroundImageUrl: parseSafeExternalHttpUrl(form.backgroundImageUrl),
    themeColor: safeThemeColor(form.themeColor),
    stickyText: form.stickyText,
    bodyContent: form.bodyContent,
    notice: form.notice,
    seoTitle: form.seoTitle,
    seoDescription: form.seoDescription,
    promoVideo: promoVideo ? { title: form.promoVideo!.title, videoUrl: promoVideo } : null,
    sessions: selectPublicRegistrationSessions(sessions, {
      now,
      hideExpiredSessions: form.hideExpiredSessions,
      maxVisibleSessions: form.maxVisibleSessions,
    }),
  };
}

export async function loadPublicRegistrationForm(slug: string, now = new Date()) {
  const db = getDb();
  const form = await db.registrationForm.findFirst({
    where: { slug, isActive: true },
    select: PUBLIC_REGISTRATION_FORM_SELECT,
  });
  if (!form) return null;

  const sessions = await db.live.findMany({
    where: publicRegistrationSessionWhere(form.id, form.vendorId),
    select: {
      id: true,
      title: true,
      description: true,
      scheduledAt: true,
      status: true,
      endedAt: true,
    },
  });

  return publicFormFromRecord(form, sessions, now);
}

export const getPublicRegistrationForm = cache((slug: string) => loadPublicRegistrationForm(slug));
