import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  vendorFindUnique: vi.fn(),
  liveFindFirst: vi.fn(),
  liveFindMany: vi.fn(),
  getStatement: vi.fn(),
  notFound: vi.fn(() => { throw new Error("not-found"); }),
}));

vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }));
vi.mock("@/lib/db", () => ({ getDb: () => ({
  vendor: { findUnique: mocks.vendorFindUnique },
  live: { findFirst: mocks.liveFindFirst, findMany: mocks.liveFindMany },
}) }));
vi.mock("@/lib/affiliate-portal", () => ({ getAffiliatePortalStatement: mocks.getStatement }));
vi.mock("@/lib/app-url", () => ({ getCanonicalAppUrl: () => "https://app.example.test" }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));

import AffiliateStatement from "./page";

const row = { monthKey: "2026-10", status: "pending", attributedAt: new Date("2026-10-06T00:00:00.000Z"), balanceCents: 6900 };
const statement = {
  affiliate: { id: "affiliate-upline", name: "合成上線", code: "TESTP1" },
  balanceCents: 11970,
  requiresReconciliation: false,
  commissions: [
    { ...row, id: "commission-direct", source: { kind: "direct" } },
    { ...row, id: "commission-upline", balanceCents: 2070, source: { kind: "upline", level: 1, referralCode: "TESTP2" } },
    { ...row, id: "commission-upline-no-code", balanceCents: 1000, source: { kind: "upline", level: 2, referralCode: null } },
  ],
  nextCursor: null,
};

function render() {
  return AffiliateStatement({
    params: Promise.resolve({ vendorSlug: "synthetic-shop", affiliateId: "affiliate-upline" }),
    searchParams: Promise.resolve({}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAuth.mockResolvedValue({ user: { id: "user-upline" } });
  mocks.vendorFindUnique.mockResolvedValue({ id: "vendor-current", enabledFeatureModules: [] });
  mocks.liveFindMany.mockResolvedValue([]);
  mocks.getStatement.mockResolvedValue(statement);
});

describe("/affiliate-portal/[vendorSlug]/[affiliateId]", () => {
  it("shows each commission's source with only the level and public referral code", async () => {
    const html = renderToStaticMarkup(await render());

    expect(html).toContain("<th>來源</th>");
    expect(html).toContain("直接推廣");
    expect(html).toContain("團隊上線（第 1 層）· 來自 TESTP2");
    expect(html).toContain("團隊上線（第 2 層）</td>");
    expect(html).not.toContain("團隊上線（第 2 層）· 來自");
    expect(html).toContain("<td>NT$69</td>");
    // Source rows are wrapped by a horizontally scrollable table container.
    expect(html).toMatch(/<div class="[^"]*overflow-x-auto[^"]*"><table/u);
  });

  it("reads the statement for the authenticated user and the slug's vendor only", async () => {
    await render();
    expect(mocks.getStatement).toHaveBeenCalledWith(expect.anything(), { userId: "user-upline" }, "vendor-current", "affiliate-upline", undefined);
  });

  it("fails closed when the statement is not authorized", async () => {
    mocks.getStatement.mockResolvedValue(null);
    await expect(render()).rejects.toThrow("not-found");
  });
});
