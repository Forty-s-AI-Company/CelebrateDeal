"use client";

import { useEffect, useState } from "react";
import { FunnelPageDocumentRenderer } from "@/components/landing-pages/funnel-page-document-renderer";
import { FunnelPopupPreview } from "@/components/landing-pages/funnel-popup-preview";
import type { PageDocument } from "@/lib/funnel-page-document";

export function PublicFunnelDocument({ document, viewport }: { document: PageDocument; viewport?: "desktop" | "mobile" }) {
  const [responsiveViewport, setResponsiveViewport] = useState<"desktop" | "mobile">("desktop");
  useEffect(() => {
    const media = window.matchMedia("(max-width: 639px)");
    const update = () => setResponsiveViewport(media.matches ? "mobile" : "desktop");
    update(); media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const selectedViewport = viewport ?? responsiveViewport;
  return <>
    <FunnelPageDocumentRenderer document={document} viewport={selectedViewport} mode="preview" />
    {document.popups
      .filter((popup) => !popup.pageId || popup.pageId === document.id)
      .map((popup) => <FunnelPopupPreview key={popup.id} document={document} popupId={popup.id} viewport={selectedViewport} />)}
  </>;
}
