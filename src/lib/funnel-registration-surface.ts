import { getFunnelNodeDefinition, type FunnelNode, type PageDocument } from "@/lib/funnel-page-document";

/**
 * Whether a published page document can render the bound registration form
 * (a lead `form` node, or a `survey` that submits through it), mirroring the
 * public renderer: checkout-contact and payment forms never collect leads.
 * Used to read a single-use retry draft only when a form will consume it.
 */
export function pageDocumentRendersRegistrationForm(document: PageDocument): boolean {
  const renders = (nodes: FunnelNode[] | undefined): boolean => (nodes ?? []).some((node) => {
    if (node.type === "survey") return true;
    if (node.type === "form"
      && node.props.variant !== "checkout-contact"
      && !(node.children ?? []).some((child) => getFunnelNodeDefinition(child.type).category === "payment")) return true;
    return renders(node.children);
  });
  return renders(document.root) || document.popups.some((popup) => renders(popup.root));
}
