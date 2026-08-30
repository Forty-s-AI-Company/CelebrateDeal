import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireVendorManager: vi.fn(),
  templateFindFirst: vi.fn(),
  notFound: vi.fn(() => { throw new Error("NOT_FOUND"); }),
}));

vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/lib/auth", () => ({ requireVendorManager: mocks.requireVendorManager }));
vi.mock("@/lib/db", () => ({
  getDb: () => ({ messageTemplate: { findFirst: mocks.templateFindFirst } }),
}));
vi.mock("@/components/ui", () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  ButtonLink: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
  Card: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
  PageHeader: ({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) => <header><h1>{title}</h1><p>{description}</p>{action}</header>,
}));

import MessageTemplatePreviewPage from "./page";

const baseTemplate = {
  id: "template/one",
  name: "報名成功信",
  channel: "email",
  trigger: "registration_confirmed",
  subject: "歡迎 {{name}}",
  body: "第一行\n第二行 {{live_title}}\n<script>不應執行</script>",
  isActive: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireVendorManager.mockResolvedValue({ id: "vendor-1" });
  mocks.templateFindFirst.mockResolvedValue(baseTemplate);
});

describe("message template preview", () => {
  it("uses tenant-safe lookup with an explicit select and renders safe sample content", async () => {
    const html = renderToStaticMarkup(await MessageTemplatePreviewPage({ params: Promise.resolve({ id: "template/one" }) }));
    expect(mocks.templateFindFirst).toHaveBeenCalledWith({
      where: { id: "template/one", vendorId: "vendor-1" },
      select: {
        id: true,
        name: true,
        channel: true,
        trigger: true,
        subject: true,
        body: true,
        isActive: true,
      },
    });
    expect(html).toContain("報名成功信");
    expect(html).toContain("歡迎 王小明");
    expect(html).toContain("一頁式研討會實戰");
    expect(html).toContain("示範資料");
    expect(html).toContain("不會寄送 Email");
    expect(html).toContain('href="/messages/templates/template%2Fone/edit"');
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;不應執行&lt;/script&gt;");
  });

  it("preserves line breaks and safe wrapping classes for the body", async () => {
    const html = renderToStaticMarkup(await MessageTemplatePreviewPage({ params: Promise.resolve({ id: "template/one" }) }));
    expect(html).toContain("break-words");
    expect(html).toContain("第一行<br/>第二行 一頁式研討會實戰");
  });

  it("uses a subject fallback and keeps legacy trigger text safe", async () => {
    mocks.templateFindFirst.mockResolvedValue({ ...baseTemplate, subject: "   ", trigger: "legacy_trigger", isActive: false });
    const html = renderToStaticMarkup(await MessageTemplatePreviewPage({ params: Promise.resolve({ id: "template/one" }) }));
    expect(html).toContain("未設定主旨");
    expect(html).toContain("未知觸發條件");
    expect(html).toContain("停用");
  });

  it("labels a post-live follow-up template and expands only sample variables", async () => {
    mocks.templateFindFirst.mockResolvedValue({
      ...baseTemplate,
      trigger: "post_live_followup",
      subject: "課後通知 {{live_title}}",
      body: "嗨 {{name}}，謝謝參加。{{unsubscribe_url}}",
    });

    const html = renderToStaticMarkup(await MessageTemplatePreviewPage({ params: Promise.resolve({ id: "template/one" }) }));

    expect(html).toContain("課後通知");
    expect(html).toContain("嗨 王小明，謝謝參加。");
    expect(html).toContain('href="https://example.com/unsubscribe"');
    expect(html).not.toContain("{{name}}");
    expect(html).not.toContain("{{unsubscribe_url}}");
  });

  it("calls notFound for a missing or foreign template", async () => {
    mocks.templateFindFirst.mockResolvedValue(null);
    await expect(MessageTemplatePreviewPage({ params: Promise.resolve({ id: "foreign-template" }) })).rejects.toThrow("NOT_FOUND");
    expect(mocks.notFound).toHaveBeenCalledExactlyOnceWith();
  });

  it("does not render a form or send action while using only sample substitutions", async () => {
    const html = renderToStaticMarkup(await MessageTemplatePreviewPage({ params: Promise.resolve({ id: "template/one" }) }));
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<button");
    expect(html).toContain("王小明");
    expect(html).toContain("示範研討會");
    expect(html).not.toContain("{{name}}");
    expect(html).not.toContain("{{live_title}}");
  });
});
