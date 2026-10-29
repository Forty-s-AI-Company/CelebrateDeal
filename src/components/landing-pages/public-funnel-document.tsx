"use client";

import { useEffect, useState } from "react";
import { FunnelPageDocumentRenderer, type FunnelRenderEvent, type FunnelSubmissionContext, type FunnelViewport } from "@/components/landing-pages/funnel-page-document-renderer";
import { FunnelPopupPreview } from "@/components/landing-pages/funnel-popup-preview";
import type { PageDocument } from "@/lib/funnel-page-document";
import type { FunnelCommerceView } from "@/lib/funnel-commerce";
import type { FunnelRegistrationLinks } from "@/lib/funnel-registration-action";
import { FUNNEL_DESKTOP_MIN_WIDTH, FUNNEL_TABLET_MIN_WIDTH, funnelViewportForWidth } from "@/lib/funnel-typography";
import { FunnelRegistrationLinkProvider } from "./funnel-registration-links";
import { FunnelCustomCodeDisclosure, FunnelCustomCodeTopNotice } from "./funnel-custom-code-disclosure";
import { documentCustomCodeSummary } from "@/lib/funnel-custom-code";

/**
 * Public render path. Without an explicit `viewport` the page follows the
 * window width (I-1: ≤ 639 mobile, 640–1079 tablet, ≥ 1080 desktop). The
 * server passes `initialViewport` (guessed from the User-Agent) so the first
 * paint already has the right layout; matchMedia corrects it after mount.
 */
export function PublicFunnelDocument({ document, viewport, initialViewport = "desktop", event, submission, consultation, commerce, registrationLinks }: { document: PageDocument; viewport?: FunnelViewport; initialViewport?: FunnelViewport; event?: FunnelRenderEvent; submission?: FunnelSubmissionContext; consultation?: { csrfToken: string; events: Array<{ id: string; title: string; description: string | null; timezone: string; durationMinutes: number; intakeFormFields: unknown }> }; commerce?: FunnelCommerceView; registrationLinks?: FunnelRegistrationLinks }) {
  const [responsiveViewport, setResponsiveViewport] = useState<FunnelViewport>(initialViewport);
  useEffect(() => {
    const mobile = window.matchMedia(`(max-width: ${FUNNEL_TABLET_MIN_WIDTH - 1}px)`);
    const desktop = window.matchMedia(`(min-width: ${FUNNEL_DESKTOP_MIN_WIDTH}px)`);
    const update = () => setResponsiveViewport(mobile.matches ? "mobile" : desktop.matches ? "desktop" : funnelViewportForWidth(window.innerWidth));
    update(); mobile.addEventListener("change", update); desktop.addEventListener("change", update);
    return () => { mobile.removeEventListener("change", update); desktop.removeEventListener("change", update); };
  }, []);
  const selectedViewport = viewport ?? responsiveViewport;
  const customCode = documentCustomCodeSummary(document);
  const content = <>
    {/* Platform notices stay outside the page content container, so custom CSS cannot select them. */}
    <FunnelCustomCodeTopNotice summary={customCode} />
    <FunnelPageDocumentRenderer document={document} viewport={selectedViewport} mode="preview" submission={submission} consultation={consultation} commerce={commerce} event={event} publicSurface />
    {document.popups
      .filter((popup) => !popup.pageId || popup.pageId === document.id)
      .map((popup) => <FunnelPopupPreview key={popup.id} document={document} commerce={commerce} publicSurface popupId={popup.id} viewport={selectedViewport} />)}
    <FunnelCustomCodeDisclosure summary={customCode} />
  </>;
  // Without explicit links, inherit the caller's (webinar experience, editor preview) instead of resetting them.
  return registrationLinks ? <FunnelRegistrationLinkProvider value={registrationLinks}>{content}</FunnelRegistrationLinkProvider> : content;
}
