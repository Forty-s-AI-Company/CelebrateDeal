import { isValidElement, type ReactElement } from "react";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ resolve: vi.fn(), notFound: vi.fn(() => { throw new Error("NOT_FOUND"); }) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [] }) }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/post-purchase-recovery-entry", () => ({ resolvePostPurchaseRecoveryEntry: mocks.resolve }));
import Page from "./page";
import { CommerceCheckoutEntry } from "@/components/commerce-checkout-entry";
import { PostPurchaseUnavailableError } from "@/lib/post-purchase-credit";
beforeEach(() => vi.clearAllMocks());
it("passes only the server-authorized original recovery record to the real entry", async () => {
  const record = { vendorId: "vendor-1", productId: "product-1", idempotencyKey: "123e4567-e89b-42d3-a456-426614174000" };
  mocks.resolve.mockResolvedValueOnce(record);
  const page = await Page({ params: Promise.resolve({ grantId: "target-grant" }) });
  const children = page.props.children as ReactElement<{ recoveryRecord?: unknown }>[];
  const entry = children.find(child => isValidElement(child) && child.type === CommerceCheckoutEntry);
  expect(entry?.props.recoveryRecord).toEqual(record);
  expect(mocks.resolve).toHaveBeenCalledWith(expect.anything(), expect.anything(), "target-grant");
});
it("rejects an unavailable or foreign capability without rendering an alternate order", async () => {
  mocks.resolve.mockRejectedValueOnce(new PostPurchaseUnavailableError());
  await expect(Page({ params: Promise.resolve({ grantId: "foreign-target" }) })).rejects.toThrow("NOT_FOUND");
  expect(mocks.notFound).toHaveBeenCalledOnce();
});
