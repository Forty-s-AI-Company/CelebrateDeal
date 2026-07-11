import { notFound } from "next/navigation";
import { LivePlayback } from "@/components/live-playback";
import { getDb } from "@/lib/db";
import {
  getLivePublicationIssue,
  hasForeignLiveRelations,
  isLivePubliclyAccessible,
} from "@/lib/live-publication";

function normalizeFields(fields: unknown) {
  if (!Array.isArray(fields)) return [];
  return fields
    .filter((field): field is { key: string; label: string; type?: string; required?: boolean } => {
      return Boolean(field && typeof field === "object" && "key" in field && "label" in field);
    })
    .map((field) => ({
      key: String(field.key),
      label: String(field.label),
      type: typeof field.type === "string" ? field.type : "text",
      required: Boolean(field.required),
    }));
}

export default async function PublicLivePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const live = await getDb().live.findUnique({
    where: { slug },
    include: {
      vendor: true,
      video: true,
      form: true,
      interactionScript: {
        include: {
          events: {
            orderBy: { triggerSec: "asc" },
            include: { role: true },
          },
        },
      },
      products: { orderBy: { sortOrder: "asc" }, include: { product: true } },
    },
  });

  if (!live || !isLivePubliclyAccessible(live.status, live.replayEnabled)) notFound();
  if (hasForeignLiveRelations(live)) notFound();
  if (getLivePublicationIssue({
    status: live.status,
    streamMode: live.streamMode,
    videoId: live.videoId,
    videoStatus: live.video?.status ?? null,
    cloudflareLiveInputUid: live.cloudflareLiveInputUid,
  })) notFound();

  return (
    <LivePlayback
      live={{
        id: live.id,
        title: live.title,
        slug: live.slug,
        description: live.description,
        accentCopy: live.accentCopy,
        heroImageUrl: live.heroImageUrl,
        videoUrl: live.video?.videoUrl ?? null,
        vendorId: live.vendorId,
        brand: {
          name: live.vendor.name,
          logoUrl: live.vendor.logoUrl,
          primaryColor: live.vendor.primaryColor,
          ctaColor: live.vendor.ctaColor,
        },
        form: live.form
          ? {
              id: live.form.id,
              headline: live.form.headline,
              description: live.form.description,
              fields: normalizeFields(live.form.fields),
              submitLabel: live.form.submitLabel,
              successMessage: live.form.successMessage,
            }
          : null,
        interactionEvents: live.interactionScript?.events.map((event) => ({
          id: event.id,
          eventType: event.eventType,
          triggerSec: event.triggerSec,
          title: event.title,
          message: event.message,
          productId: event.productId,
          ctaLabel: event.ctaLabel,
          ctaUrl: event.ctaUrl,
          role: event.role
            ? {
                name: event.role.name,
                avatarUrl: event.role.avatarUrl,
                label: event.role.label,
                roleType: event.role.roleType,
              }
            : null,
        })) ?? [],
        products: live.products.map((item) => ({
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
