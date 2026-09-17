import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { FunnelTemplateGalleryPicker } from "./funnel-template-gallery-picker";
import { listFunnelTemplateGallery } from "@/lib/funnel-template-gallery";

describe("FunnelTemplateGalleryPicker", () => {
  it("以正式 PageDocument renderer 呈現模板縮圖與可鍵盤操作的按鈕", () => {
    const html = renderToStaticMarkup(<FunnelTemplateGalleryPicker templates={listFunnelTemplateGallery("audience")} selectedId="audience-volunteer" onSelect={vi.fn()} onApply={vi.fn()} />);
    expect(html.match(/data-funnel-renderer/g)?.length).toBe(3);
    expect(html).toContain("在地志工招募");
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("完整預覽");
    expect(html).toContain("套用模板");
  });

  it("沒有模板時顯示可理解的空狀態", () => {
    const html = renderToStaticMarkup(<FunnelTemplateGalleryPicker templates={[]} selectedId="" onSelect={vi.fn()} onApply={vi.fn()} />);
    expect(html).toContain('role="status"');
    expect(html).toContain("還沒有可用模板");
    expect(html).toContain("從空白頁開始");
  });

  it("長文與卡片容器保留最小寬度與斷行規則，避免手機水平溢位", () => {
    const html = renderToStaticMarkup(<FunnelTemplateGalleryPicker templates={listFunnelTemplateGallery("custom")} selectedId="custom-brand-info" onSelect={vi.fn()} onApply={vi.fn()} />);
    expect(html).toContain("min-w-0");
    expect(html).toContain("break-words");
    expect(html).toContain("focus-visible:ring-2");
  });
});
