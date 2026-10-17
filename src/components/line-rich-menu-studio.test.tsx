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
    expect(html).toContain("同步會更換官方帳號的預設圖文選單");
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
  it("offers explicit image/sync controls only after a saved draft, with public placeholder links",()=>{
    const menu=createRichMenuTemplate("minimal-4");
    const html=renderToStaticMarkup(<LineRichMenuStudio csrfToken="synthetic" connected existing={{id:"draft-a",revision:3,menu}}/>);
    expect(html).toMatch(/<input(?=[^>]*type="file")(?=[^>]*name="image")[^>]*>/u);expect(html).toContain('value="sync"');
    for(const name of ["live_url","portal_url","consultation_url","voucher_url"])expect(html).toContain(`name="${name}"`);
    expect(html).toContain("先儲存草稿，再選擇圖片");
  });
  it.each(["syncing","uncertain"] as const)("does not show %s as synced and leaves read-only reconciliation available",status=>{
    const menu=createRichMenuTemplate("minimal-4");
    const html=renderToStaticMarkup(<LineRichMenuStudio csrfToken="synthetic" connected existing={{id:"draft-a",revision:3,menu,publication:{status,confirmedAt:null,expiresAt:"2026-10-16T01:02:00.000Z",links:{}}}}/>);
    expect(html).toMatch(/<fieldset disabled=""/u);expect(html).toContain('value="reconcile"');
    expect(html).toContain("確認 LINE 目前狀態");expect(html).not.toContain("LINE 已確認使用這次同步的選單");
  });
});
