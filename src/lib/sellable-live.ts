import type { Prisma } from "@prisma/client";

import {
  hasUsableMessageTemplateContent,
  REGISTRATION_CONFIRMATION_EMAIL_TEMPLATE_WHERE,
} from "@/lib/message-template";
import { isLiveVideoReady, liveReadyVideoWhere } from "@/lib/live-video-readiness";
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
  form: { select: { fields: true } },
  messageTemplate: { select: { subject: true, body: true } },
  video: {
    select: {
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
      ...publicLiveAvailabilityWhere(),
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

export function isSellableLiveReadinessCandidate(candidate: SellableLiveReadinessCandidate) {
  const template = candidate.messageTemplate;
  return Boolean(
    candidate.form
    && isLiveVideoReady(candidate.video)
    && parseRegistrationFormFields(candidate.form.fields).success
    && template
    && hasUsableMessageTemplateContent(template),
  );
}

export function countSellableLiveReadinessCandidates(
  candidates: readonly SellableLiveReadinessCandidate[],
) {
  return candidates.filter(isSellableLiveReadinessCandidate).length;
}
