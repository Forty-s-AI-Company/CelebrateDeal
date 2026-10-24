import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FunnelElementInspector, inspectorSectionFor } from "@/components/landing-pages/funnel-element-inspector";
import { getFunnelElementInspectorDefinition } from "@/lib/funnel-element-inspector";
import type { FunnelNode } from "@/lib/funnel-page-document";

const button: FunnelNode = { schemaVersion: 1, id: "cta_button", type: "button", props: { label: "立即加入" }, style: {}, overrides: {}, visible: true, actions: [], attributes: {} };

describe("FunnelElementInspector", () => {
  it("輸出分類區段、覆寫範圍與安全動作設定", () => {
    const html = renderToStaticMarkup(<FunnelElementInspector node={button} popupIds={["welcome_popup"]} onCommand={() => undefined} />);

    expect(html).toContain('data-funnel-element-inspector="true"');
    for (const label of ["內容", "字型", "尺寸與位置", "動作", "進階"]) expect(html).toContain(`<span>${label}</span>`);
    // No colour fields exist yet, so the empty section stays hidden.
    expect(html).not.toContain("<span>顏色</span>");
    expect(html).toContain("基礎值");
    expect(html).toContain("僅桌機覆寫");
    expect(html).toContain("僅手機覆寫");
    expect(html).toContain("按鈕文字");
    expect(html).toContain("套用動作");
  });

  it("keeps content, typography and size expanded while actions and advanced start collapsed", () => {
    const html = renderToStaticMarkup(<FunnelElementInspector node={button} onCommand={() => undefined} />);
    const expanded = (key: string) => new RegExp(`aria-expanded="(true|false)" aria-controls="funnel-inspector-cta_button-${key}"`, "u").exec(html)?.[1];
    expect(expanded("content")).toBe("true");
    expect(expanded("typography")).toBe("true");
    expect(expanded("size")).toBe("true");
    expect(expanded("actions")).toBe("false");
    expect(expanded("advanced")).toBe("false");
  });

  it("maps every schema field to exactly one presentation section", () => {
    const fields = getFunnelElementInspectorDefinition("text").fields;
    const byId = Object.fromEntries(fields.map((field) => [field.id, inspectorSectionFor(field)]));
    expect(byId).toMatchObject({ text: "content", fontSize: "typography", lineHeight: "typography", textAlign: "typography", padding: "size", margin: "size", width: "size", visible: "advanced", id: "advanced" });
    expect(inspectorSectionFor({ id: "textColor", label: "文字顏色", group: "design", kind: "text", target: "style" })).toBe("color");
  });
});
