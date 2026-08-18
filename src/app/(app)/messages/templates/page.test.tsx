import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireVendorManager: vi.fn(),
  templateFindMany: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a>,
}));
vi.mock("lucide-react", () => ({ Plus: () => <span>plus</span> }));
vi.mock("@/lib/auth", () => ({ requireVendorManager: mocks.requireVendorManager }));
vi.mock("@/lib/db", () => ({
  getDb: () => ({ messageTemplate: { findMany: mocks.templateFindMany } }),
}));
vi.mock("@/components/ui", () => ({
  Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  ButtonLink: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
  Card: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  EmptyState: ({ title, description, action }: { title: string; description: string; action?: ReactNode }) => <div data-testid="empty-state"><h2>{title}</h2><p>{description}</p>{action}</div>,
  PageHeader: ({ title, description, action }: { title: string; description: string; action?: ReactNode }) => <header><h1>{title}</h1><p>{description}</p>{action}</header>,
}));

import MessageTemplatesPage from "./page";

const templates = [
  {
    id: "template/one",
    name: "報名成功信",
    channel: "email",
    trigger: "registration_confirmed",
    isActive: true,
  },
  {
    id: "template-two",
    name: "舊版提醒",
    channel: "email",
    trigger: "legacy_trigger",
    isActive: false,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireVendorManager.mockResolvedValue({ id: "vendor-1" });
  mocks.templateFindMany.mockResolvedValue(templates);
});

describe("/messages/templates route", () => {
  it("uses the tenant-scoped bounded query and renders separate safe actions", async () => {
    const html = renderToStaticMarkup(await MessageTemplatesPage({
      searchParams: Promise.resolve({ q: "  webinar ", trigger: "live_reminder", status: "active" }),
    }));

    expect(mocks.templateFindMany).toHaveBeenCalledWith({
      where: {
        vendorId: "vendor-1",
        OR: [
          { name: { contains: "webinar", mode: "insensitive" } },
          { subject: { contains: "webinar", mode: "insensitive" } },
          { body: { contains: "webinar", mode: "insensitive" } },
        ],
        trigger: "live_reminder",
        isActive: true,
      },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: { id: true, name: true, channel: true, trigger: true, isActive: true },
    });
    expect(html).toContain("開播提醒");
    expect(html).toContain("未知觸發條件");
    expect(html).toContain('href="/messages/templates/template%2Fone/edit"');
    expect(html).toContain('href="/messages/templates/template%2Fone/preview"');
    expect(html).not.toContain('href="/messages/templates/template/one/edit"');
  });

  it("trims and caps a single q while ignoring array and invalid filter values", async () => {
    const longQuery = `${"x".repeat(140)}  `;
    await MessageTemplatesPage({
      searchParams: Promise.resolve({ q: [longQuery, "ignored"], trigger: ["live_reminder"], status: "paused" }),
    });

    expect(mocks.templateFindMany.mock.calls[0][0]).toEqual({
      where: { vendorId: "vendor-1" },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: { id: true, name: true, channel: true, trigger: true, isActive: true },
    });
  });

  it("searches name, subject and body case-insensitively after trimming", async () => {
    await MessageTemplatesPage({ searchParams: Promise.resolve({ q: "  優惠  " }) });
    expect(mocks.templateFindMany.mock.calls[0][0].where).toEqual({
      vendorId: "vendor-1",
      OR: [
        { name: { contains: "優惠", mode: "insensitive" } },
        { subject: { contains: "優惠", mode: "insensitive" } },
        { body: { contains: "優惠", mode: "insensitive" } },
      ],
    });
  });

  it.each([
    ["registration_confirmed", { trigger: "registration_confirmed" }],
    ["live_reminder", { trigger: "live_reminder" }],
  ] as const)("accepts the supported trigger %s", async (_value, expected) => {
    await MessageTemplatesPage({ searchParams: Promise.resolve({ trigger: _value }) });
    expect(mocks.templateFindMany.mock.calls[0][0].where).toEqual({ vendorId: "vendor-1", ...expected });
  });

  it("supports and labels the post-live follow-up trigger", async () => {
    mocks.templateFindMany.mockResolvedValue([{
      id: "follow-up-template",
      name: "課後通知信",
      channel: "email",
      trigger: "post_live_followup",
      isActive: true,
    }]);

    const html = renderToStaticMarkup(await MessageTemplatesPage({
      searchParams: Promise.resolve({ trigger: "post_live_followup" }),
    }));

    expect(mocks.templateFindMany.mock.calls[0][0].where).toEqual({
      vendorId: "vendor-1",
      trigger: "post_live_followup",
    });
    expect(html).toContain("課後通知");
    expect(html).toContain("管理報名成功、開播提醒與課後通知 Email");
  });

  it.each([
    ["active", { isActive: true }],
    ["inactive", { isActive: false }],
  ] as const)("accepts the status %s", async (_value, expected) => {
    await MessageTemplatesPage({ searchParams: Promise.resolve({ status: _value }) });
    expect(mocks.templateFindMany.mock.calls[0][0].where).toEqual({ vendorId: "vendor-1", ...expected });
  });

  it("keeps the reconciliation notice", async () => {
    const html = renderToStaticMarkup(await MessageTemplatesPage({
      searchParams: Promise.resolve({ notice: "reminders_reconciling" }),
    }));
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("使用這份模板的直播提醒正在分批更新");
  });

  it("distinguishes the initial empty state from filtered empty results", async () => {
    mocks.templateFindMany.mockResolvedValue([]);
    const initialHtml = renderToStaticMarkup(await MessageTemplatesPage({ searchParams: Promise.resolve({}) }));
    expect(initialHtml).toContain("還沒有訊息模板");
    expect(initialHtml).not.toContain("找不到符合條件的訊息模板");
    expect(initialHtml).toContain('href="/messages/templates/new"');

    const filteredHtml = renderToStaticMarkup(await MessageTemplatesPage({ searchParams: Promise.resolve({ status: "inactive" }) }));
    expect(filteredHtml).toContain("找不到符合條件的訊息模板");
    expect(filteredHtml).not.toContain("還沒有訊息模板");
    expect(filteredHtml).toContain('href="/messages/templates"');
    expect(filteredHtml).toContain("清除篩選");
  });

  it("does not wrap a row in an anchor and provides independent edit and preview links", async () => {
    const html = renderToStaticMarkup(await MessageTemplatesPage({ searchParams: Promise.resolve({}) }));
    expect(html).not.toMatch(/<a href="\/messages\/templates\/template%2Fone\/edit"[^>]*>[^<]*報名成功信/);
    expect(html).toContain("編輯");
    expect(html).toContain("預覽內容");
  });
});
