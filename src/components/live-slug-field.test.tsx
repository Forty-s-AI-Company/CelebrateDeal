import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LiveSlugField } from "./live-slug-field";

const base = { title: "", initialValue: "", serverTaken: false, draftTaken: false, onChange: vi.fn(), onAutoFill: vi.fn() };

describe("LiveSlugField", () => {
  it("is labelled 直播網址 in Chinese, not Slug, and explains what it is for", () => {
    const html = renderToStaticMarkup(<LiveSlugField {...base} />);
    expect(html).toContain("直播網址");
    expect(html).not.toContain("Slug");
    expect(html).toContain("/live/");
    expect(html).toContain("預設會依標題自動產生");
    expect(html).toContain('name="slug"');
    expect(html).toContain('aria-invalid="false"');
  });

  it("shows a field-level error when the submit was rejected because the address is taken", () => {
    const html = renderToStaticMarkup(<LiveSlugField {...base} initialValue="friday-sale" serverTaken />);
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('role="alert"');
    expect(html).toContain("這個直播網址已被使用");
  });

  it("shows the same error when the draft save reports a conflict, but not for an empty address", () => {
    expect(renderToStaticMarkup(<LiveSlugField {...base} initialValue="friday-sale" draftTaken />)).toContain("這個直播網址已被使用");
    expect(renderToStaticMarkup(<LiveSlugField {...base} initialValue="" draftTaken />)).not.toContain("這個直播網址已被使用");
  });

  it("keeps the accessible name to just 直播網址 and links help text with aria-describedby", () => {
    const html = renderToStaticMarkup(<LiveSlugField {...base} />);
    expect(html).toMatch(/<label for="live-slug">直播網址<\/label>/u);
    expect(html).toContain('id="live-slug"');
    expect(html).toContain('aria-describedby="live-slug-message"');
    expect(html).toMatch(/<span id="live-slug-message"[^>]*>[^<]*預設會依標題自動產生/u);
  });

  it("tells the user the duplicate check is unavailable without blocking", () => {
    const html = renderToStaticMarkup(<LiveSlugField {...base} initialValue="friday-sale" checkFailed />);
    expect(html).toContain("暫時無法檢查這個網址是否重複");
    expect(html).toContain('aria-invalid="false"');
  });
});
