import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireVendorOwner: vi.fn(),
  getCsrfToken: vi.fn(),
  accountFindUnique: vi.fn(),
  deliveryFindMany: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireVendorOwner: mocks.requireVendorOwner }));
vi.mock("@/lib/csrf", () => ({ getCsrfToken: mocks.getCsrfToken }));
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    lineOfficialAccount: { findUnique: mocks.accountFindUnique },
    lineDelivery: { findMany: mocks.deliveryFindMany },
  }),
}));
vi.mock("@/components/line-official-account-form", () => ({
  LineOfficialAccountForm: (props: { webhookUrl: string; lastValidatedAt: string | null }) => (
    <div data-testid="line-form">{props.webhookUrl}|{props.lastValidatedAt}</div>
  ),
}));

import LineSettingsPage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireVendorOwner.mockResolvedValue({ vendor: { id: "vendor-1" } });
  mocks.getCsrfToken.mockResolvedValue("csrf-test-token");
  mocks.accountFindUnique.mockResolvedValue({
    id: "line-account-1",
    status: "active",
    connectedAt: new Date("2026-09-05T00:00:00Z"),
    lastValidatedAt: new Date("2026-09-06T00:00:00Z"),
  });
  mocks.deliveryFindMany.mockResolvedValue([{
    id: "delivery-1",
    trigger: "live_started",
    status: "sent",
    attemptCount: 1,
    createdAt: new Date("2026-09-06T01:00:00Z"),
    sentAt: new Date("2026-09-06T01:00:01Z"),
    identity: { id: "identity-123456" },
  }]);
});

describe("LineSettingsPage", () => {
  it("renders the tenant webhook URL and scoped masked delivery log", async () => {
    const html = renderToStaticMarkup(await LineSettingsPage());

    expect(mocks.accountFindUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { vendorId: "vendor-1" } }));
    expect(mocks.deliveryFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { vendorId: "vendor-1", lineOfficialAccountId: "line-account-1" },
    }));
    expect(html).toContain("/api/webhooks/line/vendor-1");
    expect(html).toContain("推播紀錄");
    expect(html).toContain("iden…3456");
    expect(html).not.toContain("identity-123456");
  });
});
