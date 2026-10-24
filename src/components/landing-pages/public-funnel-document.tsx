"use client";

import { useEffect, useState } from "react";
import { FunnelPageDocumentRenderer, type FunnelSubmissionContext } from "@/components/landing-pages/funnel-page-document-renderer";
import { FunnelPopupPreview } from "@/components/landing-pages/funnel-popup-preview";
import type { PageDocument } from "@/lib/funnel-page-document";
import type { FunnelCommerceView } from "@/lib/funnel-commerce";
import { EMPTY_REGISTRATION_LINKS, type FunnelRegistrationLinks } from "@/lib/funnel-registration-action";
import { FunnelRegistrationLinkProvider } from "./funnel-registration-links";

export function PublicFunnelDocument({ document, viewport, submission, consultation, commerce, registrationLinks = EMPTY_REGISTRATION_LINKS }: { document: PageDocument; viewport?: "desktop" | "mobile"; submission?: FunnelSubmissionContext; consultation?: { csrfToken: string; events: Array<{ id: string; title: string; description: string | null; timezone: string; durationMinutes: number; intakeFormFields: unknown }> }; commerce?: FunnelCommerceView; registrationLinks?: FunnelRegistrationLinks }) {
  const [responsiveViewport, setResponsiveViewport] = useState<"desktop" | "mobile">("desktop");
  useEffect(() => {
    const media = window.matchMedia("(max-width: 639px)");
    const update = () => setResponsiveViewport(media.matches ? "mobile" : "desktop");
    update(); media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const selectedViewport = viewport ?? responsiveViewport;
  return <FunnelRegistrationLinkProvider value={registrationLinks}>
    <FunnelPageDocumentRenderer document={document} viewport={selectedViewport} mode="preview" submission={submission} consultation={consultation} commerce={commerce} publicSurface />
    {document.popups
      .filter((popup) => !popup.pageId || popup.pageId === document.id)
      .map((popup) => <FunnelPopupPreview key={popup.id} document={document} commerce={commerce} publicSurface popupId={popup.id} viewport={selectedViewport} />)}
  </FunnelRegistrationLinkProvider>;
}
