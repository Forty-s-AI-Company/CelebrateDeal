import { FunnelPageDocumentRenderer } from "@/components/landing-pages/funnel-page-document-renderer";
import { FunnelPopupPreview } from "@/components/landing-pages/funnel-popup-preview";
import type { PageDocument } from "@/lib/funnel-page-document";

export function PublicFunnelDocument({ document }: { document: PageDocument }) {
  return <>
    <FunnelPageDocumentRenderer document={document} viewport="desktop" mode="preview" />
    {document.popups
      .filter((popup) => !popup.pageId || popup.pageId === document.id)
      .map((popup) => <FunnelPopupPreview key={popup.id} document={document} popupId={popup.id} viewport="desktop" />)}
  </>;
}
