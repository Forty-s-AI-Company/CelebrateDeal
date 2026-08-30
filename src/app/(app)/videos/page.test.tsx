import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireVendorManager: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a>,
}));
vi.mock("lucide-react", () => ({ Plus: () => <span>plus</span>, Film: () => <span>film</span>, Archive: () => <span>archive</span>, RotateCcw: () => <span>restore</span> }));
vi.mock("@/components/csrf-field", () => ({ CsrfField: () => null }));
vi.mock("@/lib/auth", () => ({ requireVendorManager: mocks.requireVendorManager }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ video: { findMany: mocks.findMany } }) }));
vi.mock("@/components/ui", () => ({
  Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  ButtonLink: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
  Card: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  EmptyState: ({ title, description, action }: { title: string; description: string; action?: ReactNode }) => <div data-testid="empty-state"><h2>{title}</h2><p>{description}</p>{action}</div>,
  PageHeader: ({ title, description, action }: { title: string; description: string; action?: ReactNode }) => <header><h1>{title}</h1><p>{description}</p>{action}</header>,
}));

import VideosPage from "./page";

const videos = [{
  id: "video-1",
  title: "夏季研討會",
  description: "介紹夏季方案",
  videoUrl: "https://provider.example.test/private/video.m3u8",
  sourceType: "cloudflare_stream",
  durationSec: 92,
  status: "ready",
  _count: { lives: 1, registrationFormPromoVideos: 0 },
}, {
  id: "video-2",
  title: "處理中的影片",
  description: null,
  videoUrl: "https://cdn.example.test/private/processing.m3u8",
  sourceType: "url",
  durationSec: 0,
  status: "processing",
  _count: { lives: 0, registrationFormPromoVideos: 1 },
}];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireVendorManager.mockResolvedValue({ id: "vendor-1" });
  mocks.findMany.mockResolvedValue(videos);
});

describe("/videos route", () => {
  it("uses the tenant-scoped search contract and renders safe actions", async () => {
    const html = renderToStaticMarkup(await VideosPage({ searchParams: Promise.resolve({ q: "  研討會  ", status: "ready" }) }));
    expect(mocks.findMany).toHaveBeenCalledWith({
      where: {
        vendorId: "vendor-1",
        OR: [
          { title: { contains: "研討會", mode: "insensitive" } },
          { description: { contains: "研討會", mode: "insensitive" } },
        ],
        status: "ready",
      },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { _count: { select: { lives: true, registrationFormPromoVideos: true } } },
    });
    expect(html).toContain("夏季研討會");
    expect(html).toContain("尚無縮圖");
    expect(html).toContain("可播放");
    expect(html).toContain("01:32");
    expect(html).toContain('href="/videos/video-1/edit"');
    expect(html).toContain('href="/videos/video-1/preview"');
    expect(html).not.toContain("provider.example.test");
  });

  it("takes the first query value, trims and caps q, and ignores forged status", async () => {
    const longQuery = `${"x".repeat(140)}  `;
    await VideosPage({ searchParams: Promise.resolve({ q: [longQuery, "ignored"], status: ["deleted", "ready"] }) });
    expect(mocks.findMany.mock.calls[0][0].where).toEqual({
      vendorId: "vendor-1",
      OR: [
        { title: { contains: "x".repeat(128), mode: "insensitive" } },
        { description: { contains: "x".repeat(128), mode: "insensitive" } },
      ],
    });
  });

  it("uses the bounded default query when no filters are present", async () => {
    mocks.findMany.mockResolvedValue([]);
    const html = renderToStaticMarkup(await VideosPage({ searchParams: Promise.resolve({}) }));
    expect(mocks.findMany).toHaveBeenCalledWith({
      where: { vendorId: "vendor-1" },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { _count: { select: { lives: true, registrationFormPromoVideos: true } } },
    });
    expect(html).toContain("還沒有影片");
    expect(html).toContain("/videos/new");
    expect(html).not.toContain("找不到符合條件的影片");
  });

  it("distinguishes a filtered empty result and offers clear filters", async () => {
    mocks.findMany.mockResolvedValue([]);
    const html = renderToStaticMarkup(await VideosPage({ searchParams: Promise.resolve({ q: "不存在" }) }));
    expect(html).toContain("找不到符合條件的影片");
    expect(html).not.toContain("還沒有影片");
    expect(html).toContain('href="/videos"');
    expect(html).toContain("清除篩選");
  });
});
