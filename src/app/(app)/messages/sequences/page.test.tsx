import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireVendorManager: vi.fn(),
  sequenceFindMany: vi.fn(),
  sequenceCount: vi.fn(),
  liveFindFirst: vi.fn(),
  groupBy: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a>,
}));
vi.mock("@/lib/auth", () => ({ requireVendorManager: mocks.requireVendorManager }));
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    emailSequence: { findMany: mocks.sequenceFindMany, count: mocks.sequenceCount },
    live: { findFirst: mocks.liveFindFirst },
    delayedStepRun: { groupBy: mocks.groupBy },
  }),
}));
vi.mock("@/components/csrf-field", () => ({ CsrfField: () => <input type="hidden" name="_csrf" value="synthetic" /> }));
vi.mock("@/app/actions/email-sequence-actions", () => ({
  activateEmailSequenceAction: vi.fn(),
  pauseEmailSequenceAction: vi.fn(),
  deleteEmailSequenceAction: vi.fn(),
}));

import EmailSequencesPage from "./page";

const vendor = { id: "vendor-1", enabledFeatureModules: [], betaFeatureGrants: ["email_sequences"] };

async function render(searchParams: Record<string, string> = {}) {
  return renderToStaticMarkup(await EmailSequencesPage({ searchParams: Promise.resolve(searchParams) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireVendorManager.mockResolvedValue(vendor);
  mocks.sequenceCount.mockResolvedValue(1);
  mocks.liveFindFirst.mockResolvedValue(null);
  mocks.groupBy.mockResolvedValue([
    { emailSequenceId: "seq-1", status: "active", _count: { _all: 4 } },
    { emailSequenceId: "seq-1", status: "completed", _count: { _all: 2 } },
    { emailSequenceId: "seq-1", status: "cancelled", _count: { _all: 1 } },
  ]);
  mocks.sequenceFindMany.mockResolvedValue([
    {
      id: "seq-1",
      name: "報名後三天追銷",
      status: "active",
      version: 3,
      live: { id: "live-1", title: "春季直播" },
      steps: [{ delayMinutes: 60, isActive: true }, { delayMinutes: 1_440, isActive: true }, { delayMinutes: 4_320, isActive: false }],
    },
    { id: "seq-2", name: "草稿序列", status: "draft", version: 1, live: { id: "live-1", title: "春季直播" }, steps: [] },
  ]);
});

describe("/messages/sequences", () => {
  it("answers 404 while the vendor lacks the email_sequences grant, before reading any sequence", async () => {
    mocks.requireVendorManager.mockResolvedValueOnce({ ...vendor, betaFeatureGrants: [] });
    await expect(render()).rejects.toMatchObject({ digest: expect.stringContaining("404") });
    expect(mocks.sequenceFindMany).not.toHaveBeenCalled();
  });

  it("lists the vendor's sequences with live, steps, status and per-status people counts", async () => {
    const html = await render();
    expect(mocks.sequenceFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { vendorId: "vendor-1" } }));
    expect(mocks.groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: { vendorId: "vendor-1", emailSequenceId: { not: null } } }));
    expect(html).toContain("報名後三天追銷");
    expect(html).toContain("直播：春季直播");
    expect(html).toContain("2 封：驗證後 1 小時、驗證後第 1 天");
    expect(html).toContain("寄送中");
    expect(html).toContain("4 人");
    expect(html).toContain("2 人");
    expect(html).toContain("1 人");
    expect(html).toContain("還沒有要寄的信");
    expect(html).toContain("寄送中 1／5 條");
    // An active sequence offers pause, a draft offers activate; both carry the version.
    expect(html).toContain("暫停");
    expect(html).toContain("啟用");
    expect(html).toContain('name="expectedVersion" value="3"');
    expect(html).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  });

  it("filters by a Live of this vendor only and keeps the new-sequence link on it", async () => {
    mocks.liveFindFirst.mockResolvedValueOnce({ id: "live-1", title: "春季直播" });
    const html = await render({ liveId: "live-1" });
    expect(mocks.liveFindFirst).toHaveBeenCalledWith({ where: { id: "live-1", vendorId: "vendor-1" }, select: { id: true, title: true } });
    expect(mocks.sequenceFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { vendorId: "vendor-1", liveId: "live-1" } }));
    expect(html).toContain("只顯示「春季直播」的序列");
    expect(html).toContain('href="/messages/sequences/new?liveId=live-1"');
  });

  it("shows bounded notices and errors from the query and ignores unknown ones", async () => {
    expect(await render({ notice: "paused" })).toContain("重新啟用後也不會補寄");
    expect(await render({ error: "active_limit" })).toContain("最多 5 條寄送中的序列");
    const unknown = await render({ error: "<script>" });
    expect(unknown).not.toContain("&lt;script&gt;");
    expect(unknown).not.toContain('role="alert"');
  });

  it("shows an empty state", async () => {
    mocks.sequenceFindMany.mockResolvedValueOnce([]);
    mocks.groupBy.mockResolvedValueOnce([]);
    expect(await render()).toContain("還沒有追銷序列");
  });
});
