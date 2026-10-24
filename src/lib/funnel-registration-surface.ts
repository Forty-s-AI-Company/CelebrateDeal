import { getFunnelNodeDefinition, type FunnelNode, type PageDocument } from "@/lib/funnel-page-document";
import { REGISTRATION_FORM_FIELD_KEY, REGISTRATION_FORM_RESERVED_FIELDS, type RegistrationFormFieldSpec } from "@/lib/registration-form-fields";

type PageNodes = Pick<PageDocument, "root" | "popups">;

function someNode(document: PageNodes, predicate: (node: FunnelNode) => boolean): boolean {
  const visit = (nodes: FunnelNode[] | undefined): boolean => (nodes ?? []).some((node) => predicate(node) || visit(node.children));
  return visit(document.root) || document.popups.some((popup) => visit(popup.root));
}

function eachNode(document: PageNodes, callback: (node: FunnelNode) => void) {
  const visit = (nodes: FunnelNode[] | undefined) => (nodes ?? []).forEach((node) => { callback(node); visit(node.children); });
  visit(document.root);
  document.popups.forEach((popup) => visit(popup.root));
}

/**
 * A lead `form` node, mirroring the public renderer: checkout-contact and
 * payment forms never collect leads.
 */
export function isLeadCaptureFormNode(node: FunnelNode): boolean {
  return node.type === "form"
    && node.props.variant !== "checkout-contact"
    && !(node.children ?? []).some((child) => getFunnelNodeDefinition(child.type).category === "payment");
}

/**
 * Whether a published page document can render the bound registration form
 * (a lead `form` node, or a `survey` that submits through it), mirroring the
 * public renderer. Used to read a single-use retry draft only when a form
 * will consume it.
 */
export function pageDocumentRendersRegistrationForm(document: PageNodes): boolean {
  return someNode(document, (node) => node.type === "survey" || isLeadCaptureFormNode(node));
}

/** Any purchase surface: a commerce binding, a payment block or a checkout-contact form. */
export function pageDocumentHasCommerce(document: PageNodes & { commerce?: unknown }): boolean {
  return pageDocumentCommerceKinds(document).length > 0;
}

export type PageDocumentCommerceKind = "binding" | "payment" | "checkout_form";

/** The kinds of purchase surface on a page, in a stable order; empty when it has none. */
export function pageDocumentCommerceKinds(document: PageNodes & { commerce?: unknown }): PageDocumentCommerceKind[] {
  const kinds: PageDocumentCommerceKind[] = [];
  if (document.commerce) kinds.push("binding");
  if (someNode(document, (node) => getFunnelNodeDefinition(node.type).category === "payment")) kinds.push("payment");
  if (someNode(document, (node) => node.type === "form" && node.props.variant === "checkout-contact")) kinds.push("checkout_form");
  return kinds;
}

function stringProp(props: Record<string, unknown>, keys: string[], fallback = "") {
  for (const key of keys) {
    const value = props[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return fallback;
}

/**
 * The answer field a public survey submits, using the renderer's field-key
 * rule (`name`, `fieldName` or `id` prop, else the node id). Keys that a
 * registration form cannot carry are skipped, so such a survey stays
 * disabled exactly as it renders today.
 */
export function surveyLeadFormFields(document: PageNodes, taken: ReadonlySet<string>): RegistrationFormFieldSpec[] {
  const fields: RegistrationFormFieldSpec[] = [];
  const used = new Set(taken);
  eachNode(document, (node) => {
    if (node.type !== "survey") return;
    const candidate = stringProp(node.props, ["name", "fieldName", "id"], node.id);
    const key = REGISTRATION_FORM_FIELD_KEY.test(candidate) ? candidate : node.id;
    if (!REGISTRATION_FORM_FIELD_KEY.test(key) || REGISTRATION_FORM_RESERVED_FIELDS.has(key) || used.has(key)) return;
    used.add(key);
    fields.push({ key, label: stringProp(node.props, ["question", "title", "label"], "請選擇一個答案").slice(0, 160), type: "text", required: node.props.required === true });
  });
  return fields;
}
