import { getLivePublishReadiness } from "@/lib/live-publish-readiness";
import { isExistingLiveVideoReady } from "@/lib/live-video-readiness";
import { hasUsableMessageTemplateContent } from "@/lib/message-template";
import { parseRegistrationFormFields } from "@/lib/registration-form-fields";

export type RuntimeLivePublishCandidate = {
  vendorId: string;
  video: {
    vendorId: string;
    sourceType: string;
    status: string;
    cloudflareReadyToStream: boolean;
    cloudflareLiveInputUid: string | null;
    liveInputStatus: string | null;
  } | null;
  form: { vendorId: string; isActive: boolean; fields: unknown } | null;
  messageTemplate: {
    vendorId: string;
    channel: string;
    trigger: string;
    isActive: boolean;
    subject: string | null;
    body: string;
  } | null;
  interactionScript: { vendorId: string; status: string } | null;
  products: Array<{
    vendorId: string;
    product: { vendorId: string; isActive: boolean; fulfillmentTypeConfirmed: boolean };
  }>;
};

export function getRuntimeLivePublishReadiness(live: RuntimeLivePublishCandidate) {
  const productsReady = live.products.every((item) => (
    item.vendorId === live.vendorId
    && item.product.vendorId === live.vendorId
    && item.product.isActive
    && item.product.fulfillmentTypeConfirmed
  ));
  const registrationEmailReady = Boolean(
    live.messageTemplate
    && live.messageTemplate.vendorId === live.vendorId
    && live.messageTemplate.channel === "email"
    && live.messageTemplate.trigger === "registration_confirmed"
    && live.messageTemplate.isActive
    && hasUsableMessageTemplateContent(live.messageTemplate),
  );
  return getLivePublishReadiness({
    productCount: live.products.length,
    productsReady,
    videoReady: Boolean(live.video?.vendorId === live.vendorId && isExistingLiveVideoReady(live.video)),
    formReady: Boolean(
      live.form?.vendorId === live.vendorId
      && live.form.isActive
      && parseRegistrationFormFields(live.form.fields).success,
    ),
    registrationEmailReady,
    interactionScriptReady: Boolean(
      live.interactionScript?.vendorId === live.vendorId
      && live.interactionScript.status === "published",
    ),
  });
}
