import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const delegates = {
    salesProject: { findFirst: vi.fn() },
    salesProjectProduct: { create: vi.fn() },
    product: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
    imageAsset: { findFirst: vi.fn() },
    teamMembership: { findFirst: vi.fn() },
    vendorDeliveryUrlAllowlist: { upsert: vi.fn() },
    productDeliveryConfig: { create: vi.fn(), updateMany: vi.fn() },
  };
  return {
    delegates,
    db: {
      ...delegates,
      vendor: { findUnique: vi.fn(async () => ({ betaFeatureGrants: [] })) },
      $transaction: vi.fn((callback: (tx: typeof delegates) => unknown) => callback(delegates)),
    },
    requireVendorManager: vi.fn(),
    revalidatePath: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({ getDb: () => mocks.db }));
vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: async () => undefined }));
vi.mock("@/lib/auth", () => ({ requireVendorManager: mocks.requireVendorManager, requireVendorManagerContext: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { createProductQuickAction } from "@/app/actions/live-resource-quick-create";
import { initialProductActionState } from "@/lib/product-action-state";
import { mutateProduct } from "./product-save";

/** What the full product editor (`product-form-client.tsx`) submits for a new, listed physical product. */
function fullEditorCreate(values: { name: string; slug: string; price: string; inventory: string; projectId?: string }) {
  const data = new FormData();
  if (values.projectId) data.set("projectId", values.projectId);
  data.set("_csrf", "synthetic");
  data.set("name", values.name);
  data.set("slug", values.slug);
  data.set("price", values.price);
  data.set("compareAt", "");
  data.set("currency", "TWD");
  data.set("inventory", values.inventory);
  data.set("fulfillmentType", "physical");
  data.set("customCheckoutFields", "[]");
  data.set("upsellProductId", "");
  data.set("upsellDiscount", "0");
  data.set("downsellProductId", "");
  data.set("description", "");
  data.set("imageUrl", "");
  data.set("imageAssetId", "");
  data.set("imageUploadPhase", "idle");
  data.set("checkoutUrl", "");
  data.set("isActive", "on");
  return data;
}

function createdRow(call = 0) {
  const { id, slug, ...rest } = mocks.delegates.product.create.mock.calls[call]![0].data as Record<string, unknown>;
  return { id, slug, rest };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireVendorManager.mockResolvedValue({ id: "vendor-1" });
  mocks.delegates.salesProject.findFirst.mockResolvedValue({ id: "project-1" });
  mocks.delegates.salesProjectProduct.create.mockResolvedValue({ id: "link-1" });
  mocks.delegates.product.findFirst.mockResolvedValue(null);
  mocks.delegates.product.findMany.mockResolvedValue([]);
  mocks.delegates.product.create.mockImplementation(async ({ data }: { data: { id: string } }) => ({ id: data.id }));
  mocks.delegates.imageAsset.findFirst.mockResolvedValue(null);
  mocks.db.$transaction.mockImplementation((callback: (tx: typeof mocks.delegates) => unknown) => callback(mocks.delegates));
});

describe("mutateProduct (shared product core)", () => {
  it("still creates the full editor's product and now also reports the written id and name", async () => {
    const result = await mutateProduct("vendor-1", initialProductActionState, fullEditorCreate({ name: " 原型食物餐盒 ", slug: "whole-food-box", price: "1290", inventory: "20", projectId: "project-1" }));

    const { id, slug, rest } = createdRow();
    expect(result).toEqual({ ok: true, destination: "/products?updated=created", product: { id, name: "原型食物餐盒" } });
    expect(slug).toBe("whole-food-box");
    expect(rest).toMatchObject({
      vendorId: "vendor-1",
      name: "原型食物餐盒",
      priceCents: 129_000,
      compareAtCents: null,
      currency: "TWD",
      inventory: 20,
      isActive: true,
      fulfillmentType: "physical",
      fulfillmentTypeConfirmed: true,
      commerceDomain: "merchant",
    });
    // The project is resolved for this vendor and linked inside the same transaction.
    expect(mocks.delegates.salesProject.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "project-1", vendorId: "vendor-1" }) }));
    expect(mocks.delegates.salesProjectProduct.create).toHaveBeenCalledWith({ data: { vendorId: "vendor-1", projectId: "project-1", productId: id } });
    expect(mocks.delegates.productDeliveryConfig.create).not.toHaveBeenCalled();
  });

  it("still reports the editor's failures unchanged", async () => {
    mocks.delegates.salesProject.findFirst.mockResolvedValueOnce(null);
    expect(await mutateProduct("vendor-1", initialProductActionState, fullEditorCreate({ name: "x", slug: "x", price: "1290", inventory: "1", projectId: "project-foreign" })))
      .toMatchObject({ ok: false, state: { version: 1, error: "not_found" } });
    expect(await mutateProduct("vendor-1", initialProductActionState, fullEditorCreate({ name: "x", slug: "x", price: "0", inventory: "1" })))
      .toMatchObject({ ok: false, state: { error: "invalid_product", fieldErrors: { price: "上架商品的售價必須大於 0。" } } });
    mocks.delegates.product.findFirst.mockResolvedValueOnce({ id: "product-taken" });
    expect(await mutateProduct("vendor-1", initialProductActionState, fullEditorCreate({ name: "x", slug: "taken", price: "1290", inventory: "1" })))
      .toMatchObject({ ok: false, state: { error: "duplicate_slug" } });
    expect(mocks.delegates.product.create).not.toHaveBeenCalled();
  });

  it("writes the same product from the studio's quick create as from the full editor with the same values", async () => {
    await mutateProduct("vendor-1", initialProductActionState, fullEditorCreate({ name: "原型食物餐盒", slug: "原型食物餐盒", price: "1290", inventory: "20", projectId: "project-1" }));
    const quick = await createProductQuickAction((() => {
      const data = new FormData();
      data.set("_csrf", "synthetic");
      data.set("name", "原型食物餐盒");
      data.set("price", "1290");
      data.set("inventory", "20");
      data.set("fulfillmentType", "physical");
      data.set("projectId", "project-1");
      return data;
    })());

    const fromEditor = createdRow(0);
    const fromStudio = createdRow(1);
    expect(quick).toEqual({ status: "success", option: { id: fromStudio.id, name: "原型食物餐盒", inventory: 20 } });
    expect(fromStudio.slug).toBe(fromEditor.slug);
    expect(fromStudio.rest).toEqual(fromEditor.rest);
    expect(mocks.delegates.salesProjectProduct.create).toHaveBeenLastCalledWith({ data: { vendorId: "vendor-1", projectId: "project-1", productId: fromStudio.id } });
  });
});
