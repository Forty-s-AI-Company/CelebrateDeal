import { describe, expect, it } from "vitest";
import { collectFunnelCustomCode, contentHasCustomScript } from "@/lib/funnel-custom-code";
import type { FunnelNode } from "@/lib/funnel-page-document";
import { FUNNEL_TEMPLATE_GALLERY, instantiateFunnelTemplate } from "@/lib/funnel-template-gallery";

function flatten(nodes: FunnelNode[]): FunnelNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children ?? [])]);
}

// Platform templates are applied by any merchant, including ones without a
// verified e-mail, so they must never carry 自訂 JS or 頁面自訂 CSS that the
// #499 custom-code gate would then refuse (or the merchant did not write).
describe("platform templates and custom code", () => {
  it.each(FUNNEL_TEMPLATE_GALLERY.map((template) => [template.id]))("%s has no custom JavaScript and no page custom CSS", (id) => {
    const document = instantiateFunnelTemplate(id, `custom_code_check_${id}`);
    const nodes = [...flatten(document.root), ...document.popups.flatMap((popup) => flatten(popup.root))];
    for (const node of nodes.filter((item) => item.type === "raw_html")) {
      expect(typeof node.props.js === "string" ? node.props.js.trim() : "", `${id}/${node.id}`).toBe("");
    }
    expect(document.settings.customCss ?? "").toBe("");
    expect(contentHasCustomScript(document)).toBe(false);
    expect(collectFunnelCustomCode(document).pageCss.size).toBe(0);
  });
});
