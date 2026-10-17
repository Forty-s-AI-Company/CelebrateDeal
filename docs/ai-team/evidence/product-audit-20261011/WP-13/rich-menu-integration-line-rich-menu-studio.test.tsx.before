import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/app/actions/line-rich-menu-actions", () => ({ updateRichMenuDraftAction: vi.fn() }));
import { LineRichMenuStudio } from "./line-rich-menu-studio";
import { createRichMenuTemplate } from "@/lib/line-rich-menu";

describe("rich menu draft editor", () => {
  it("offers both templates, includes CSRF and starts without an existing reference", () => {
    const html = renderToStaticMarkup(<LineRichMenuStudio csrfToken="synthetic-csrf" existing={null} />);
    expect(html).toContain("6 格範本"); expect(html).toContain("4 格範本");
    expect(html).toContain('name="_csrf" value="synthetic-csrf"');
    expect(html).toContain('name="revision" value="0"');
    expect(html).toContain("儲存草稿"); expect(html).not.toContain("刪除草稿");
    expect(html).toContain("同步至 LINE 的功能尚未開放");
  });
  it("loads existing content, escaped labels, and revision without exposing clickable preview URLs", () => {
    const menu = createRichMenuTemplate("minimal-4");
    menu.name = "我的草稿"; menu.areas[0]!.action.label = "<svg onload=x>";
    const html = renderToStaticMarkup(<LineRichMenuStudio csrfToken="synthetic" existing={{ id: "draft-a", revision: 3, menu }} />);
    expect(html).toContain('name="id" value="draft-a"');
    expect(html).toContain('name="revision" value="3"');
    expect(html).toContain("我的草稿"); expect(html).toContain("刪除草稿");
    expect(html).toContain("&lt;svg onload=x&gt;"); expect(html).not.toContain("<svg onload=x>");
    expect(html).not.toContain("href=");
  });
});
