import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireVendorManager: vi.fn(),
  findMany: vi.fn(),
  getCsrfToken: vi.fn(),
}));

vi.mock("@/app/actions", () => ({ upsertBlacklistAction: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireVendorManager: mocks.requireVendorManager }));
vi.mock("@/lib/csrf", () => ({ getCsrfToken: mocks.getCsrfToken }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ blacklist: { findMany: mocks.findMany } }) }));
vi.mock("@/components/csrf-field", () => ({ CsrfField: () => <input type="hidden" name="_csrf" value="csrf-test" /> }));
vi.mock("@/components/blacklist-search-list", () => ({ BlacklistSearchList: () => <div data-testid="blacklist-list" /> }));

import BlacklistsPage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireVendorManager.mockResolvedValue({ id: "vendor-1" });
  mocks.getCsrfToken.mockResolvedValue("csrf-test");
  mocks.findMany.mockResolvedValue([]);
});

describe("BlacklistsPage keyword controls", () => {
  it("exposes the keyword option, literal matching guidance, and associated labels", async () => {
    const html = renderToStaticMarkup(await BlacklistsPage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain('<option value="keyword">禁止關鍵字</option>');
    expect(html).toContain("純文字片段比對");
    expect(html).toContain("不會執行正規表示式或萬用字元");
    expect(html).toMatch(/<label[^>]*>識別值或關鍵字<input[^>]*name="identifier"/);
    expect(html).toMatch(/<label[^>]*>類型<select[^>]*name="identifierType"/);
  });
});
