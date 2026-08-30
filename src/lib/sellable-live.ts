import type { Prisma } from "@prisma/client";

import {
  hasUsableMessageTemplateContent,
  REGISTRATION_CONFIRMATION_EMAIL_TEMPLATE_WHERE,
} from "@/lib/message-template";
import { isLiveVideoReady, liveReadyVideoWhere } from "@/lib/live-video-readiness";
import { resolveLiveRuntime } from "@/lib/live-runtime-state";
import { parseRegistrationFormFields } from "@/lib/registration-form-fields";

export function publicLiveAvailabilityWhere(): Prisma.LiveWhereInput {
  return {
    OR: [
      { status: { in: ["scheduled", "live"] } },
      { status: "ended", replayEnabled: true },
    ],
  };
}

export const SELLABLE_LIVE_READINESS_SELECT = {
  scheduledAt: true,
  status: true,
  startedAt: true,
  endedAt: true,
  replayAvailableUntil: true,
  replayEnabled: true,
  streamMode: true,
  form: { select: { fields: true } },
  messageTemplate: { select: { subject: true, body: true } },
  video: {
    select: {
      durationSec: true,
      sourceType: true,
      status: true,
      cloudflareReadyToStream: true,
      cloudflareLiveInputUid: true,
      liveInputStatus: true,
    },
  },
} satisfies Prisma.LiveSelect;

export function sellableLiveReadinessQuery(vendorId: string) {
  return {
    where: {
      vendorId,
      // Readiness is an internal backend gate. Audience admission applies the
      // stricter public availability predicate separately.
      status: { in: ["scheduled", "live", "ended"] },
      video: { is: liveReadyVideoWhere(vendorId) },
      form: { is: { vendorId, isActive: true } },
      messageTemplate: {
        is: {
          vendorId,
          ...REGISTRATION_CONFIRMATION_EMAIL_TEMPLATE_WHERE,
        },
      },
      interactionScript: { is: { vendorId, status: "published" } },
      products: {
        some: {
          vendorId,
          product: {
            is: {
              vendorId,
              isActive: true,
              fulfillmentTypeConfirmed: true,
            },
          },
        },
      },
    },
    select: SELLABLE_LIVE_READINESS_SELECT,
  } satisfies Prisma.LiveFindManyArgs;
}

export type SellableLiveReadinessCandidate = Prisma.LiveGetPayload<{
  select: typeof SELLABLE_LIVE_READINESS_SELECT;
}>;

export function isSellableLiveReadinessCandidate(
  candidate: SellableLiveReadinessCandidate,
  now = new Date(),
) {
  const template = candidate.messageTemplate;
  const runtime = resolveLiveRuntime(candidate, now);
  return Boolean(
    runtime.state !== "unavailable"
    && candidate.form
    && isLiveVideoReady(candidate.video)
    && parseRegistrationFormFields(candidate.form.fields).success
    && template
    && hasUsableMessageTemplateContent(template),
  );
}

export function countSellableLiveReadinessCandidates(
  candidates: readonly SellableLiveReadinessCandidate[],
  now = new Date(),
) {
  return candidates.filter((candidate) => isSellableLiveReadinessCandidate(candidate, now)).length;
}
