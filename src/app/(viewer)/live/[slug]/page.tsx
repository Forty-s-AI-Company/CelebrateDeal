import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { cache } from "react";
import {
  evergreenSettingEvents,
  revealEvergreenProducts,
  revealEvergreenTimeline,
  type EvergreenRevealPosition,
} from "@/lib/evergreen-offer-timeline";
import {
  evergreenSessionTokenFromCookieHeader,
  resolveEvergreenViewerSession,
  type EvergreenLiveRecord,
  type EvergreenViewerSession,
} from "@/lib/evergreen-viewer-session";
import { PersistentLivePlaybackRegistration } from "@/components/persistent-live-playback";
import { getDb } from "@/lib/db";
import { getRuntimeLivePublishReadiness } from "@/lib/live-runtime-readiness";
import { normalizeScheduledRuntimeMessage, type ScheduledRuntimeMessage } from "@/lib/live-chat-contract";
import { parseRegistrationFormFields } from "@/lib/registration-form-fields";
import { publicLiveAvailabilityWhere } from "@/lib/sellable-live";
import { resolveLiveRuntime } from "@/lib/live-runtime-state";
import { buildShareMetadata, shareDescription, unavailableShareMetadata } from "@/lib/public-share-metadata";
import { publicInteractionMetadata } from "@/lib/public-interaction-metadata";
import { isProductPurchasable } from "@/lib/feature-gates";

const loadPublicLive = cache(async (slug: string) => {
  const serverNow = new Date();
  const publicAvailability = publicLiveAvailabilityWhere();
  const live = await getDb().live.findFirst({
    where: {
      slug,
      // Keep the shared public gate for playable lives, but retain ended
      // lifecycle records locally so an expired replay can render a truthful
      // unavailable state instead of becoming an indistinguishable 404.
      OR: [
        ...(publicAvailability.OR ?? []),
        { status: "ended", replayEnabled: false },
        { status: "ended", replayAvailableUntil: { lte: serverNow } },
      ],
    },
    include: {
      vendor: true,
      video: true,
      form: true,
      messageTemplate: true,
      interactionScript: {
        include: {
          events: {
            orderBy: { triggerSec: "asc" },
            include: { role: true },
          },
        },
      },
      products: {
        orderBy: { sortOrder: "asc" },
        include: { product: true },
      },
    },
  });
  return { live, serverNow };
});

/**
 * Reads (never assigns) the visitor's signed evergreen session. Cookies can
 * only be written by the session Route Handler, which the page calls when no
 * session exists yet. The raw Cookie header goes through the same parser the
 * Route Handlers use, so the page and the APIs always agree on the token.
 */
async function readEvergreenSession(
  live: EvergreenLiveRecord & { isEvergreen?: boolean | null; vendor: { timezone?: string | null } },
  serverNow: Date,
): Promise<EvergreenViewerSession | null> {
  if (live.isEvergreen !== true) return null;
  const token = evergreenSessionTokenFromCookieHeader((await headers()).get("cookie"), live.id);
  return resolveEvergreenViewerSession({
    live,
    vendorTimezone: live.vendor.timezone,
    token,
    intent: "read",
    now: serverNow,
  });
}

function evergreenRevealPosition(session: EvergreenViewerSession): EvergreenRevealPosition {
  if (!session.assigned) return "none";
  if (session.runtimeState === "playing") return session.playback.offsetSeconds;
  if (session.runtimeState === "replay") return "all";
  return "none";
}

type ProjectableEvent = { eventType: string; triggerSec: number; productId: string | null };

/**
 * Evergreen offers are revealed server-side up to the visitor's own session
 * offset; later ones are withheld and only their next second is shipped.
 */
function projectEvergreenPage<E extends ProjectableEvent, P extends { product: { id: string }; offerLabel: string | null }>(
  session: EvergreenViewerSession,
  input: {
    events: E[];
    products: P[];
    pitchAtSeconds: number | null;
    consultationAtSeconds: number | null;
    consultationFormAvailable: boolean;
  },
) {
  const position = evergreenRevealPosition(session);
  const firstProduct = input.products[0];
  const timeline = revealEvergreenTimeline(
    [
      ...input.events,
      ...evergreenSettingEvents({
        pitchAtSeconds: input.pitchAtSeconds,
        consultationAtSeconds: input.consultationAtSeconds,
        pitchProduct: firstProduct ? { id: firstProduct.product.id, offerLabel: firstProduct.offerLabel } : null,
        consultationFormAvailable: input.consultationFormAvailable,
      }),
    ].sort((left, right) => left.triggerSec - right.triggerSec),
    position,
  );
  const products = revealEvergreenProducts(input.products.map((item) => ({ ...item, id: item.product.id })), timeline.events, position);
  return {
    events: timeline.events,
    products,
    evergreen: {
      assigned: session.assigned,
      mode: session.schedule.mode,
      timezone: session.schedule.timezone,
      roomState: session.playback.roomState,
      sessionStartAt: session.sessionStartAt.toISOString(),
      sessionEndAt: session.playback.sessionEndAt.toISOString(),
      offsetSeconds: session.playback.offsetSeconds,
      nextRevealAtSec: timeline.nextRevealAtSec,
      canRejoin: session.canRejoin,
    },
  };
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const { live } = await loadPublicLive(slug);
  // 與頁面使用同一套公開條件：找不到或尚未達發布條件時不洩漏任何內容。
  if (!live || !getRuntimeLivePublishReadiness(live).ready) return unavailableShareMetadata();
  return buildShareMetadata({
    title: live.title,
    description: shareDescription(live.accentCopy, live.description, `${live.vendor.name} 的直播`),
    imageUrl: live.heroImageUrl ?? live.vendor.logoUrl,
    siteName: live.vendor.name,
  });
}

export default async function PublicLivePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { live, serverNow } = await loadPublicLive(slug);

  if (!live) {
    console.warn("PUBLIC_LIVE_NOT_FOUND_AVAILABILITY");
    notFound();
  }
  const runtime = resolveLiveRuntime({
    streamMode: live.streamMode,
    scheduledAt: live.scheduledAt,
    status: live.status,
    startedAt: live.startedAt,
    endedAt: live.endedAt,
    replayAvailableUntil: live.replayAvailableUntil,
    replayEnabled: live.replayEnabled,
    video: live.video ? { durationSec: live.video.durationSec } : null,
  }, serverNow);
  const readiness = getRuntimeLivePublishReadiness(live);
  if (!readiness.ready) {
    console.warn("PUBLIC_LIVE_NOT_FOUND_READINESS", readiness.blockers.map(({ code }) => code));
    notFound();
  }
  // An evergreen Live follows the visitor's own session instead of scheduledAt.
  const evergreen = await readEvergreenSession(live, serverNow);
  const runtimeState = evergreen ? evergreen.runtimeState : runtime.state;
  const sameVendorActiveForm = Boolean(live.form?.vendorId === live.vendorId && live.form.isActive);
  const parsedFormFields = sameVendorActiveForm ? parseRegistrationFormFields(live.form?.fields) : null;
  const formConfigurationUnavailable = Boolean(sameVendorActiveForm && parsedFormFields && !parsedFormFields.success);
  // Course products are not offered while the courses module is closed (F-001).
  const liveProducts = live.products.filter((item) => isProductPurchasable(live.vendor, item.product));
  const liveProductIds = new Set(liveProducts.map((item) => item.product.id));
  const publishedEvents = live.interactionScript?.vendorId === live.vendorId
    && live.interactionScript.status === "published"
    ? live.interactionScript.events
    : [];
  const scheduledMessages = publishedEvents
    .filter((event) => event.eventType === "chat_message" || event.eventType === "reminder")
    .map((event): ScheduledRuntimeMessage | null => normalizeScheduledRuntimeMessage({
      vendorId: live.vendorId,
      event: {
        id: event.id,
        eventType: event.eventType,
        triggerSec: event.triggerSec,
        message: event.message,
      },
      role: event.role
        ? {
            vendorId: event.role.vendorId,
            name: event.role.name,
            avatarUrl: event.role.avatarUrl,
            label: event.role.label,
            roleType: event.role.roleType,
            isActive: event.role.isActive,
            isScheduled: event.role.isScheduled,
          }
        : null,
    }))
    .filter((message): message is ScheduledRuntimeMessage => message !== null);
  const scriptedInteractionEvents = publishedEvents
      .filter((event) => event.eventType !== "chat_message" && event.eventType !== "reminder")
      .filter((event) => (
        event.eventType !== "product_spotlight"
        || Boolean(event.productId && liveProductIds.has(event.productId))
      ))
      .map((event) => ({
        id: event.id,
        eventType: event.eventType,
        triggerSec: event.triggerSec,
        title: event.title,
        message: event.message,
        productId: event.productId,
        ctaLabel: event.ctaLabel,
        ctaUrl: event.ctaUrl,
        ...publicInteractionMetadata(event, liveProductIds),
        role: event.role?.vendorId === live.vendorId
          ? {
              name: event.role.name,
              avatarUrl: event.role.avatarUrl,
              label: event.role.label,
            }
          : null,
      }));
  const publicForm = sameVendorActiveForm && live.form && parsedFormFields?.success
    ? {
        id: live.form.id,
        headline: live.form.headline,
        description: live.form.description,
        fields: parsedFormFields.data,
        submitLabel: live.form.submitLabel,
        successMessage: live.form.successMessage,
      }
    : null;
  const projected = evergreen
    ? projectEvergreenPage(evergreen, {
        events: scriptedInteractionEvents,
        products: liveProducts,
        pitchAtSeconds: live.evergreenPitchAtSeconds ?? null,
        consultationAtSeconds: live.evergreenConsultationAtSeconds ?? null,
        consultationFormAvailable: Boolean(publicForm),
      })
    : null;

  return (
    <PersistentLivePlaybackRegistration
      live={{
        id: live.id,
        title: live.title,
        slug: live.slug,
        status: live.status,
        runtimeState,
        scheduledAt: evergreen ? evergreen.sessionStartAt.toISOString() : live.scheduledAt.toISOString(),
        ...(projected ? { evergreen: projected.evergreen } : {}),
        serverNow: serverNow.toISOString(),
        description: live.description,
        accentCopy: live.accentCopy,
        heroImageUrl: live.heroImageUrl,
        vendorId: live.vendorId,
        admissionRequired: true,
        chatEnabled: Boolean(sameVendorActiveForm && parsedFormFields?.success),
        brand: {
          name: live.vendor.name,
          logoUrl: live.vendor.logoUrl,
          primaryColor: live.vendor.primaryColor,
          ctaColor: live.vendor.ctaColor,
        },
        form: publicForm,
        ...(formConfigurationUnavailable ? { formConfigurationUnavailable: true } : {}),
        interactionEvents: projected?.events ?? scriptedInteractionEvents,
        scheduledMessages,
        products: (projected?.products ?? liveProducts).map((item) => ({
          id: item.product.id,
          name: item.product.name,
          description: item.product.description,
          priceCents: item.product.priceCents,
          compareAtCents: item.product.compareAtCents,
          currency: item.product.currency,
          imageUrl: item.product.imageUrl,
          checkoutUrl: item.product.checkoutUrl,
          offerLabel: item.offerLabel,
        })),
      }}
    />
  );
}
