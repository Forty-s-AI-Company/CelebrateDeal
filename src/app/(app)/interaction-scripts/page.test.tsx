import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireVendorManager: vi.fn(),
  count: vi.fn(),
  findMany: vi.fn(),
  duplicateAction: vi.fn(),
  deleteAction: vi.fn(),
}));

vi.mock("next/image", () => ({ default: ({ src, alt }: { src: string; alt: string }) => <span data-image-src={src} aria-label={alt} /> }));
vi.mock("next/link", () => ({ default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a> }));
vi.mock("lucide-react", () => ({ Copy: () => <span>copy</span>, Pencil: () => <span>pencil</span>, Plus: () => <span>plus</span>, Trash2: () => <span>trash</span> }));
vi.mock("@/app/actions", () => ({ deleteInteractionScriptAction: mocks.deleteAction, duplicateInteractionScriptAction: mocks.duplicateAction }));
vi.mock("@/components/csrf-field", () => ({ CsrfField: () => <input type="hidden" name="csrfToken" value="synthetic-csrf" /> }));
vi.mock("@/lib/auth", () => ({ requireVendorManager: mocks.requireVendorManager }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ interactionScript: { count: mocks.count, findMany: mocks.findMany } }) }));
vi.mock("@/components/ui", () => ({
  Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  ButtonLink: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
  Card: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  EmptyState: ({ title, description, action }: { title: string; description: string; action?: ReactNode }) => <div data-testid="empty-state"><h2>{title}</h2><p>{description}</p>{action}</div>,
  PageHeader: ({ title, description, action }: { title: string; description: string; action?: ReactNode }) => <header><h1>{title}</h1><p>{description}</p>{action}</header>,
}));

import InteractionScriptsPage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireVendorManager.mockResolvedValue({ id: "vendor-1" });
  mocks.count.mockResolvedValue(21);
  mocks.findMany.mockResolvedValue([
    { id: "script-1", name: "開場節奏", description: "暖場與 CTA", status: "PUBLISHED", events: [{ id: "event-1", triggerSec: 12, title: "歡迎" }], lives: [{ title: "八月直播", video: { thumbnailUrl: "https://cdn.example.test/thumb.jpg", title: "精華片段" } }] },
    { id: "script-2", name: "草稿節奏", description: null, status: "DRAFT", events: [], lives: [{ title: null, video: null }] },
  ]);
});

describe("/interaction-scripts route", () => {
  it("parses pagination, scopes the vendor query, and renders bound and unbound states", async () => {
    const html = renderToStaticMarkup(await InteractionScriptsPage({ searchParams: Promise.resolve({ page: "2", pageSize: "10" }) }));

    expect(mocks.requireVendorManager).toHaveBeenCalledExactlyOnceWith();
    expect(mocks.count).toHaveBeenCalledWith({ where: { vendorId: "vendor-1" } });
    expect(mocks.findMany).toHaveBeenCalledWith({
      where: { vendorId: "vendor-1" }, orderBy: { createdAt: "desc" }, skip: 10, take: 10,
      include: { events: { orderBy: { triggerSec: "asc" } }, lives: { include: { video: true } } },
    });
    expect(html).toContain("留言組");
    expect(html).toContain("開場節奏");
    expect(html).toContain("12s · 歡迎");
    expect(html).toContain("/interaction-scripts/script-1/edit");
    expect(html).toContain("https://cdn.example.test/thumb.jpg");
    expect(html).toContain("尚未綁定影片");
    expect(html).toContain("未填寫說明");
    expect(html).toContain("第 2 / 3 頁，共 21 筆");
    expect(html).toContain("page=1&amp;pageSize=10");
  });

  it("clamps malformed pagination and renders the empty state", async () => {
    mocks.count.mockResolvedValue(0);
    mocks.findMany.mockResolvedValue([]);

    const html = renderToStaticMarkup(await InteractionScriptsPage({ searchParams: Promise.resolve({ page: "-4", pageSize: "bad" }) }));

    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 0, take: 10 }));
    expect(html).toContain("還沒有留言組");
    expect(html).toContain("建立留言組後");
  });

  it("caps unsupported page sizes and explains why an unsafe legacy script cannot be copied", async () => {
    const html = renderToStaticMarkup(await InteractionScriptsPage({
      searchParams: Promise.resolve({ page: "1", pageSize: "50000", error: "invalid_event" }),
    }));

    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 0, take: 10 }));
    expect(html).toContain('role="alert"');
    expect(html).toContain("含有無效或不安全的事件");
    expect(html).toContain("複製");
    expect(html).toContain("刪除");
    expect(html).toContain('aria-busy="false"');
  });

  it("explains a cross-vendor or inactive legacy reference without copying it", async () => {
    const html = renderToStaticMarkup(await InteractionScriptsPage({
      searchParams: Promise.resolve({ error: "invalid_reference" }),
    }));

    expect(html).toContain('role="alert"');
    expect(html).toContain("引用了其他商店、已停用或不存在的角色／商品");
  });

  it("explains that a stale or cross-vendor script must be selected again", async () => {
    const html = renderToStaticMarkup(await InteractionScriptsPage({
      searchParams: Promise.resolve({ error: "missing_script" }),
    }));

    expect(html).toContain('role="alert"');
    expect(html).toContain("已不存在或不屬於目前商店");
    expect(html).toContain("請重新選擇");
  });
});
