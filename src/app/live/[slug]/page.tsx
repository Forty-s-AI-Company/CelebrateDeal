import { notFound } from "next/navigation";
import { LivePlayback } from "@/components/live-playback";
import { getDb } from "@/lib/db";
import { getRuntimeLivePublishReadiness } from "@/lib/live-runtime-readiness";
import { normalizeScheduledRuntimeMessage, type ScheduledRuntimeMessage } from "@/lib/live-chat-contract";
import { parseRegistrationFormFields } from "@/lib/registration-form-fields";
import { publicLiveAvailabilityWhere } from "@/lib/sellable-live";

export default async function PublicLivePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const live = await getDb().live.findFirst({
    where: {
      slug,
      ...publicLiveAvailabilityWhere(),
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

  if (!live) notFound();
  if (!getRuntimeLivePublishReadiness(live).ready) notFound();
  const sameVendorActiveForm = Boolean(live.form?.vendorId === live.vendorId && live.form.isActive);
  const parsedFormFields = sameVendorActiveForm ? parseRegistrationFormFields(live.form?.fields) : null;
  const formConfigurationUnavailable = Boolean(sameVendorActiveForm && parsedFormFields && !parsedFormFields.success);
  const liveProductIds = new Set(live.products.map((item) => item.product.id));
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
  const interactionEvents = publishedEvents
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
        role: event.role?.vendorId === live.vendorId
          ? {
              name: event.role.name,
              avatarUrl: event.role.avatarUrl,
              label: event.role.label,
            }
          : null,
      }))

  return (
    <LivePlayback
      live={{
        id: live.id,
        title: live.title,
        slug: live.slug,
        status: live.status,
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
        form: sameVendorActiveForm && live.form && parsedFormFields?.success
          ? {
              id: live.form.id,
              headline: live.form.headline,
              description: live.form.description,
              fields: parsedFormFields.data,
              submitLabel: live.form.submitLabel,
              successMessage: live.form.successMessage,
            }
          : null,
        ...(formConfigurationUnavailable ? { formConfigurationUnavailable: true } : {}),
        interactionEvents,
        scheduledMessages,
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
