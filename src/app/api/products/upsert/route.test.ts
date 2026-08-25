import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertServerActionSecurity: vi.fn(),
  getCurrentAuth: vi.fn(),
  mutateProduct: vi.fn(),
}));

vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: mocks.assertServerActionSecurity }));
vi.mock("@/lib/auth", () => ({ getCurrentAuth: mocks.getCurrentAuth }));
vi.mock("@/app/actions/product-actions", () => ({ mutateProduct: mocks.mutateProduct }));

import { POST } from "./route";

function request(fields: Record<string, string> = {}) {
  const body = new FormData();
  body.set("_csrf", "synthetic-csrf");
  for (const [key, value] of Object.entries(fields)) body.set(key, value);
  return new Request("https://app.example.test/api/products/upsert", {
    method: "POST",
    headers: { origin: "https://app.example.test" },
    body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assertServerActionSecurity.mockResolvedValue(undefined);
  mocks.getCurrentAuth.mockResolvedValue({
    vendor: { id: "vendor-1" },
    member: { status: "active", role: "owner" },
  });
});

describe("POST /api/products/upsert", () => {
  it("redirects a successful create with 303 on the request origin", async () => {
    mocks.mutateProduct.mockResolvedValue({ ok: true, destination: "/products?updated=created" });

    const response = await POST(request({ name: "商品" }));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://app.example.test/products?updated=created");
    expect(mocks.mutateProduct).toHaveBeenCalledWith("vendor-1", { version: 0 }, expect.any(FormData));
  });

  it("returns only an allowlisted validation error and never echoes the draft", async () => {
    mocks.mutateProduct.mockResolvedValue({
      ok: false,
      state: {
        version: 1,
        error: "invalid_delivery",
        draft: { deliveryUrl: "https://private.example.test/path" },
      },
    });

    const response = await POST(request());

    expect(response.status).toBe(422);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({ error: "invalid_delivery" });
  });

  it("fails closed before authentication when origin or CSRF validation fails", async () => {
    mocks.assertServerActionSecurity.mockRejectedValue(new Error("synthetic security detail"));

    const response = await POST(request());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "unavailable" });
    expect(mocks.getCurrentAuth).not.toHaveBeenCalled();
    expect(mocks.mutateProduct).not.toHaveBeenCalled();
  });

  it("rejects an oversized FormData body before authentication or mutation", async () => {
    const response = await POST(request({ name: "x".repeat(70 * 1024) }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "unavailable" });
    expect(mocks.assertServerActionSecurity).not.toHaveBeenCalled();
    expect(mocks.getCurrentAuth).not.toHaveBeenCalled();
    expect(mocks.mutateProduct).not.toHaveBeenCalled();
  });

  it("uses 401 for no session and 403 for a non-manager without exposing role details", async () => {
    mocks.getCurrentAuth.mockResolvedValueOnce(null);
    const anonymous = await POST(request());
    expect(anonymous.status).toBe(401);
    await expect(anonymous.json()).resolves.toEqual({ error: "unavailable" });

    mocks.getCurrentAuth.mockResolvedValueOnce({
      vendor: { id: "vendor-1" },
      member: { status: "active", role: "support" },
    });
    const forbidden = await POST(request());
    expect(forbidden.status).toBe(403);
    await expect(forbidden.json()).resolves.toEqual({ error: "not_found" });
    expect(mocks.mutateProduct).not.toHaveBeenCalled();
  });

  it("hides unexpected persistence errors behind a fixed error enum", async () => {
    mocks.mutateProduct.mockRejectedValue(new Error("synthetic database detail"));

    const response = await POST(request());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "unavailable" });
  });
});
