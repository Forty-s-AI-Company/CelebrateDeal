import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FunnelElementInspector } from "@/components/landing-pages/funnel-element-inspector";
import type { FunnelNode } from "@/lib/funnel-page-document";

const button: FunnelNode = { schemaVersion: 1, id: "cta_button", type: "button", props: { label: "立即加入" }, style: {}, overrides: {}, visible: true, actions: [], attributes: {} };

describe("FunnelElementInspector", () => {
  it("輸出分類、覆寫範圍與安全動作設定", () => {
    const html = renderToStaticMarkup(<FunnelElementInspector node={button} popupIds={["welcome_popup"]} onCommand={() => undefined} />);

    expect(html).toContain('data-funnel-element-inspector="true"');
    expect(html).toContain("內容");
    expect(html).toContain("設計");
    expect(html).toContain("動作");
    expect(html).toContain("進階");
    expect(html).toContain("基礎值");
    expect(html).toContain("僅桌機覆寫");
    expect(html).toContain("僅手機覆寫");
  });
});
