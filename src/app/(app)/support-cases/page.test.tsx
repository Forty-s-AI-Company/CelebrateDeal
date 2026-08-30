import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireVendorSupportMfa: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireVendorSupportMfa: mocks.requireVendorSupportMfa }));
vi.mock("@/lib/db", () => ({
  getDb: () => ({ supportCase: { findMany: mocks.findMany } }),
}));

import SupportCasesPage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireVendorSupportMfa.mockResolvedValue({ vendor: { id: "vendor-1" } });
  mocks.findMany.mockResolvedValue([]);
});

describe("/support-cases route", () => {
  it("keeps the queue tenant-scoped and accepts only canonical filters", async () => {
    const html = renderToStaticMarkup(await SupportCasesPage({
      searchParams: Promise.resolve({ status: "open", priority: "p1", q: "  CD-100  " }),
    }));

    expect(mocks.requireVendorSupportMfa).toHaveBeenCalledWith("/support-cases");
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        vendorId: "vendor-1",
        status: "open",
        priority: "p1",
        OR: [
          { caseNumber: { contains: "CD-100", mode: "insensitive" } },
          { order: { orderNumber: { contains: "CD-100", mode: "insensitive" } } },
        ],
      }),
      take: 200,
    }));
    expect(html).toContain("客服案件");
    expect(html).toContain("沒有符合條件的客服案件");
  });

  it("does not pass forged status or priority values to Prisma", async () => {
    await SupportCasesPage({
      searchParams: Promise.resolve({ status: "deleted", priority: "urgent" }),
    });

    const query = mocks.findMany.mock.calls[0][0];
    expect(query.where).toEqual({ vendorId: "vendor-1" });
  });

  it("renders only masked buyer metadata returned by the queue projection", async () => {
    mocks.findMany.mockResolvedValue([{
      id: "case-1", caseNumber: "SC-20260808-A1", category: "access", priority: "p1",
      status: "in_progress", assignedMember: { user: { name: "客服一號" } }, refundHandoff: null,
      order: {
        id: "order-1", orderNumber: "CD-100", buyerMaskedName: "王＊明",
        buyerMaskedEmail: "w***@example.test",
      },
    }]);

    const html = renderToStaticMarkup(await SupportCasesPage({}));
    expect(html).toContain("王＊明");
    expect(html).toContain("w***@example.test");
    expect(html).toContain("客服一號");
    expect(html).toContain('href="/support-cases/case-1"');
  });
});
