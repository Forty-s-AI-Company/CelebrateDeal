import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertServerActionSecurity: vi.fn(),
  requireVendorManager: vi.fn(),
  redirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`); }),
  productFindFirst: vi.fn(),
  productCreate: vi.fn(),
  productUpdateMany: vi.fn(),
  imageAssetFindFirst: vi.fn(),
  teamMembershipFindFirst: vi.fn(),
  deliveryAllowlistUpsert: vi.fn(),
  deliveryConfigCreate: vi.fn(),
  deliveryConfigUpdateMany: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: mocks.assertServerActionSecurity }));
vi.mock("@/lib/auth", () => ({ requireVendorManager: mocks.requireVendorManager }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/db", () => ({
  getDb: () => {
    const delegates = {
    product: { findFirst: mocks.productFindFirst, create: mocks.productCreate, updateMany: mocks.productUpdateMany },
    imageAsset: { findFirst: mocks.imageAssetFindFirst },
    teamMembership: { findFirst: mocks.teamMembershipFindFirst },
      vendorDeliveryUrlAllowlist: { upsert: mocks.deliveryAllowlistUpsert },
      productDeliveryConfig: { create: mocks.deliveryConfigCreate, updateMany: mocks.deliveryConfigUpdateMany },
    };
    return { ...delegates, $transaction: (callback: (tx: typeof delegates) => unknown) => mocks.transaction(callback, delegates) };
  },
}));

import { initialProductActionState } from "@/lib/product-action-state";
import { upsertProductAction } from "./product-actions";

function formData(fields: Record<string, string> = {}) {
  const data = new FormData();
  data.set("_csrf", "valid-token");
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

function validProduct(fields: Record<string, string> = {}) {
  return formData({ name: "Demo Webinar", slug: "demo-webinar", price: "12", inventory: "12", currency: "TWD", fulfillmentType: "physical", ...fields });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assertServerActionSecurity.mockResolvedValue(undefined);
  mocks.requireVendorManager.mockResolvedValue({ id: "vendor-1" });
  mocks.productFindFirst.mockResolvedValue(null);
  mocks.productCreate.mockResolvedValue({ id: "product-new" });
  mocks.productUpdateMany.mockResolvedValue({ count: 1 });
  mocks.teamMembershipFindFirst.mockResolvedValue({ id: "membership-owner" });
  mocks.deliveryAllowlistUpsert.mockResolvedValue({ id: "allowlist-1" });
  mocks.deliveryConfigCreate.mockResolvedValue({ id: "delivery-config-1" });
  mocks.deliveryConfigUpdateMany.mockResolvedValue({ count: 1 });
  mocks.transaction.mockImplementation((callback: (tx: unknown) => unknown, delegates: unknown) => callback(delegates));
  process.env.CSRF_SECRET = "g7-48-product-action-test-secret-32-bytes";
});

describe("upsertProductAction", () => {
  it("creates a draft merchant product using merchant-facing major currency units", async () => {
    const data = validProduct({ description: "  商品說明  ", compareAt: "15.50", imageUrl: "https://example.com/image.png", checkoutUrl: "https://example.com/checkout" });

    await expect(upsertProductAction(initialProductActionState, data)).rejects.toThrow("redirect:/products?updated=created");
    expect(mocks.productCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      vendorId: "vendor-1", name: "Demo Webinar", slug: "demo-webinar", description: "商品說明",
      priceCents: 1200, compareAtCents: 1550, currency: "TWD", inventory: 12, isActive: false,
      commerceDomain: "merchant", fulfillmentType: "physical", fulfillmentTypeConfirmed: true,
    }) });
  });

  it("preserves entered values when validation fails instead of redirecting away", async () => {
    const result = await upsertProductAction(initialProductActionState, validProduct({ name: "我的草稿", price: "-1", description: "不能消失" }));

    expect(result).toMatchObject({ version: 1, error: "invalid_product", draft: { name: "我的草稿", price: "-1", description: "不能消失" } });
    expect(mocks.productCreate).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("requires a valid course owner and promoter share", async () => {
    const data = validProduct({ fulfillmentType: "course", courseContentOwnerMembershipId: "membership-owner", coursePromoterShareBps: "2500" });

    await expect(upsertProductAction(initialProductActionState, data)).rejects.toThrow("redirect:/products?updated=created");
    expect(mocks.teamMembershipFindFirst).toHaveBeenCalledWith({ where: { id: "membership-owner", vendorId: "vendor-1", status: "ACTIVE", leftAt: null }, select: { id: true } });
    expect(mocks.productCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ commerceDomain: "course", fulfillmentType: "course", courseContentOwnerMembershipId: "membership-owner", coursePromoterShareBps: 2500 }) });
  });

  it("fails closed for contradictory fulfillment policy", async () => {
    const result = await upsertProductAction(initialProductActionState, validProduct({ commerceDomain: "course", fulfillmentType: "physical", courseContentOwnerMembershipId: "membership-owner", coursePromoterShareBps: "2500" }));
    expect(result.error).toBe("invalid_fulfillment");
    expect(mocks.productCreate).not.toHaveBeenCalled();
  });

  it("requires usable delivery content before a digital product can be published", async () => {
    const result = await upsertProductAction(initialProductActionState, validProduct({
      fulfillmentType: "digital",
      isActive: "on",
      deliveryTitle: "教材下載",
    }));

    expect(result).toMatchObject({ error: "invalid_delivery", draft: { deliveryTitle: "教材下載" } });
    expect(mocks.productCreate).not.toHaveBeenCalled();
    expect(mocks.deliveryConfigCreate).not.toHaveBeenCalled();
  });

  it("atomically stores an encrypted confirmed delivery config for an active digital product", async () => {
    const data = validProduct({
      fulfillmentType: "digital",
      isActive: "on",
      deliveryTitle: "教材下載",
      deliveryUrl: "https://downloads.example.com/buyer/guide.pdf",
      deliveryInstructions: "付款後即可下載。",
      deliveryHostConfirmed: "on",
    });

    await expect(upsertProductAction(initialProductActionState, data)).rejects.toThrow("redirect:/products?updated=created");
    expect(mocks.deliveryAllowlistUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { vendorId_hostname_pathPrefix: { vendorId: "vendor-1", hostname: "downloads.example.com", pathPrefix: "/buyer/guide.pdf" } },
    }));
    expect(mocks.deliveryConfigCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      vendorId: "vendor-1",
      allowlistId: "allowlist-1",
      status: "active",
      fulfillmentType: "digital",
      deliveryKind: "digital_link",
      title: "教材下載",
      destinationMaskedSummary: "安全 HTTPS 入口 · downloads.example.com",
      instructionsMaskedSummary: "已設定 8 字交付說明",
    }) });
    const persisted = JSON.stringify(mocks.deliveryConfigCreate.mock.calls);
    expect(persisted).not.toContain("https://downloads.example.com/buyer/guide.pdf");
    expect(persisted).not.toContain("付款後即可下載。");
  });

  it("rejects private or query-bearing delivery URLs before opening a transaction", async () => {
    const result = await upsertProductAction(initialProductActionState, validProduct({
      fulfillmentType: "course",
      courseContentOwnerMembershipId: "membership-owner",
      coursePromoterShareBps: "2500",
      isActive: "on",
      deliveryTitle: "課程入口",
      deliveryUrl: "https://127.0.0.1/course?token=secret",
      deliveryHostConfirmed: "on",
    }));

    expect(result.error).toBe("invalid_delivery");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects an inactive or cross-vendor course owner", async () => {
    mocks.teamMembershipFindFirst.mockResolvedValueOnce(null);
    const result = await upsertProductAction(initialProductActionState, validProduct({ fulfillmentType: "course", courseContentOwnerMembershipId: "missing-owner", coursePromoterShareBps: "2500" }));
    expect(result.error).toBe("invalid_course_owner");
    expect(mocks.productCreate).not.toHaveBeenCalled();
  });

  it("uses optimistic concurrency and increments policy version on an edit", async () => {
    mocks.productFindFirst.mockResolvedValue({ id: "product-existing", commerceDomain: "course", courseContentOwnerMembershipId: "membership-old", coursePromoterShareBps: 2000, coursePolicyVersion: 3, revision: 7 });
    const data = validProduct({ id: "product-existing", revision: "7", fulfillmentType: "course", courseContentOwnerMembershipId: "membership-owner", coursePromoterShareBps: "2500" });

    await expect(upsertProductAction(initialProductActionState, data)).rejects.toThrow("redirect:/products?updated=saved");
    expect(mocks.productUpdateMany).toHaveBeenCalledWith({
      where: { id: "product-existing", vendorId: "vendor-1", revision: 7 },
      data: expect.objectContaining({ coursePolicyVersion: 4, revision: { increment: 1 } }),
    });
  });

  it("returns a conflict without overwriting data after a concurrent inventory change", async () => {
    mocks.productFindFirst.mockResolvedValue({ id: "product-existing", commerceDomain: "merchant", courseContentOwnerMembershipId: null, coursePromoterShareBps: null, coursePolicyVersion: 1, revision: 8 });
    mocks.productUpdateMany.mockResolvedValueOnce({ count: 0 });
    const result = await upsertProductAction(initialProductActionState, validProduct({ id: "product-existing", revision: "7" }));

    expect(result.error).toBe("conflict");
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("rejects unfinished media before writing product data", async () => {
    const result = await upsertProductAction(initialProductActionState, validProduct({ imageUploadPhase: "uploading" }));
    expect(result.error).toBe("media_upload_incomplete");
    expect(mocks.productCreate).not.toHaveBeenCalled();
  });

  it("uses a ready current-vendor image asset instead of a client-supplied URL", async () => {
    mocks.imageAssetFindFirst.mockResolvedValue({ id: "asset-1", publicUrl: "https://media.example.test/product.webp" });
    await expect(upsertProductAction(initialProductActionState, validProduct({ imageAssetId: "asset-1", imageUrl: "https://attacker.example.test/forged.webp" }))).rejects.toThrow("redirect:/products?updated=created");
    expect(mocks.productCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ imageAssetId: "asset-1", imageUrl: "https://media.example.test/product.webp" }) });
  });

  it("does not disguise an image database outage as a user validation error", async () => {
    mocks.imageAssetFindFirst.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(upsertProductAction(initialProductActionState, validProduct({ imageAssetId: "asset-1" }))).rejects.toThrow("database unavailable");
    expect(mocks.productCreate).not.toHaveBeenCalled();
  });

  it("rejects unsafe external URLs and preserves the form", async () => {
    const result = await upsertProductAction(initialProductActionState, validProduct({ checkoutUrl: "ftp://example.com/checkout" }));
    expect(result).toMatchObject({ error: "invalid_product", draft: { checkoutUrl: "ftp://example.com/checkout" } });
    expect(mocks.productCreate).not.toHaveBeenCalled();
  });

  it("reports a tenant-local duplicate slug without losing the draft", async () => {
    mocks.productFindFirst.mockResolvedValueOnce({ id: "product-existing" });
    const result = await upsertProductAction(initialProductActionState, validProduct({ name: "重複商品" }));
    expect(result).toMatchObject({ error: "duplicate_slug", draft: { name: "重複商品" } });
    expect(mocks.productFindFirst).toHaveBeenCalledWith({
      where: { vendorId: "vendor-1", slug: "demo-webinar" },
      select: { id: true },
    });
    expect(mocks.productCreate).not.toHaveBeenCalled();
  });

  it("reports a tenant-local duplicate created during the race window", async () => {
    mocks.productCreate.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("duplicate", { code: "P2002", clientVersion: "6.19.3", meta: { target: ["vendorId", "slug"] } }));
    const result = await upsertProductAction(initialProductActionState, validProduct({ name: "重複商品" }));
    expect(result).toMatchObject({ error: "duplicate_slug", draft: { name: "重複商品" } });
  });

  it("reports a duplicate slug when Prisma crosses a production bundle boundary", async () => {
    mocks.productCreate.mockRejectedValueOnce({
      name: "PrismaClientKnownRequestError",
      code: "P2002",
      clientVersion: "6.19.3",
      meta: { target: ["vendorId", "slug"] },
    });
    const result = await upsertProductAction(initialProductActionState, validProduct({ name: "跨 bundle 重複商品" }));
    expect(result).toMatchObject({ error: "duplicate_slug", draft: { name: "跨 bundle 重複商品" } });
  });

  it("does not access authorization or data when CSRF validation fails", async () => {
    mocks.assertServerActionSecurity.mockRejectedValueOnce(new Error("Invalid CSRF token."));
    await expect(upsertProductAction(initialProductActionState, validProduct())).rejects.toThrow("Invalid CSRF token.");
    expect(mocks.requireVendorManager).not.toHaveBeenCalled();
    expect(mocks.productCreate).not.toHaveBeenCalled();
  });
});
