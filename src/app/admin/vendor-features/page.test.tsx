import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireFinanceAdmin: vi.fn(), findMany: vi.fn(), heldGroupBy: vi.fn() }));

vi.mock("@/lib/auth", () => ({ requireFinanceAdmin: mocks.requireFinanceAdmin }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ vendor: { findMany: mocks.findMany }, commerceEntitlement: { groupBy: mocks.heldGroupBy } }) }));
vi.mock("@/app/actions/vendor-beta-feature-actions", () => ({ updateVendorBetaFeatureGrantsAction: vi.fn() }));
vi.mock("@/app/actions/vendor-suspension-actions", () => ({ suspendVendorAction: vi.fn(), resumeVendorAction: vi.fn(), releaseHeldEntitlementsAction: vi.fn() }));
vi.mock("@/components/csrf-field", () => ({ CsrfField: () => null }));

import AdminVendorFeaturesPage from "./page";

const SAVED = "已儲存，商家下次載入頁面即生效。";

async function render(searchParams: Record<string, string>) {
  return renderToStaticMarkup(await AdminVendorFeaturesPage({ searchParams: Promise.resolve(searchParams) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireFinanceAdmin.mockResolvedValue({ user: { id: "admin-1" } });
  mocks.heldGroupBy.mockResolvedValue([]);
  mocks.findMany.mockResolvedValue([
    { id: "vendor-1", name: "商家甲", slug: "a", betaFeatureGrants: [] },
    { id: "vendor-2", name: "商家乙", slug: "b", betaFeatureGrants: ["billing"] },
  ]);
});

describe("/admin/vendor-features route", () => {
  it("gives every card an anchor id and a submit button with pending copy", async () => {
    const html = await render({});
    expect(html).toContain('id="vendor-vendor-1"');
    expect(html).toContain('id="vendor-vendor-2"');
    expect(html).toContain("儲存設定");
    expect(html).not.toContain(SAVED);
  });

  it("offers the email_sequences grant (F-3) per vendor and shows it checked only where granted", async () => {
    mocks.findMany.mockResolvedValue([
      { id: "vendor-1", name: "商家甲", slug: "a", betaFeatureGrants: [] },
      { id: "vendor-2", name: "商家乙", slug: "b", betaFeatureGrants: ["email_sequences"] },
    ]);
    const html = await render({});
    expect(html.split("Email 追銷序列").length - 1).toBe(2);
    const checked = [...html.matchAll(/<input[^>]*value="email_sequences"[^>]*>/gu)].map((match) => match[0]);
    expect(checked).toHaveLength(2);
    expect(checked.filter((input) => input.includes("checked"))).toHaveLength(1);
  });

  it("submits through FormSubmitButton with pending copy", () => {
    const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
    expect(source).toContain("<FormSubmitButton");
    expect(source).toContain('pendingChildren="儲存中…"');
    expect(source).toContain('pendingMessage="正在儲存，請勿重複送出。"');
  });

  it("shows the saved message inside the saved vendor's card only", async () => {
    const html = await render({ saved: "1", vendor: "vendor-2" });
    expect(html.split(SAVED).length - 1).toBe(1);
    const card = html.slice(html.indexOf('id="vendor-vendor-2"'));
    expect(card).toContain(SAVED);
    expect(html.slice(html.indexOf('id="vendor-vendor-1"'), html.indexOf('id="vendor-vendor-2"'))).not.toContain(SAVED);
    expect(html).toContain('data-feedback="saved"');
  });

  it("shows a conflict inside the card with error styling", async () => {
    const html = await render({ error: "conflict", vendor: "vendor-1" });
    expect(html).toContain('data-feedback="error"');
    expect(html).toContain("設定在你送出前已被其他人更新");
  });

  it("falls back to the page header when the vendor is missing or unknown", async () => {
    for (const params of [{ saved: "1" }, { saved: "1", vendor: "ghost" }] as Array<Record<string, string>>) {
      const html = await render(params);
      expect(html.split(SAVED).length - 1).toBe(1);
      expect(html).not.toContain("data-feedback");
      expect(html).not.toContain("ghost");
    }
    expect(await render({ error: "not_found" })).toContain("找不到這個商家");
  });

  it("offers suspension per vendor and shows a suspended vendor's state with a resume control (F-036)", async () => {
    mocks.findMany.mockResolvedValue([
      { id: "vendor-1", name: "商家甲", slug: "a", betaFeatureGrants: [], suspendedAt: null, suspendedReason: null },
      { id: "vendor-2", name: "商家乙", slug: "b", betaFeatureGrants: [], suspendedAt: new Date("2026-11-03T01:00:00.000Z"), suspendedReason: "合成：違規" },
    ]);
    const html = await render({});
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ select: expect.objectContaining({ suspendedAt: true, suspendedReason: true }) }));
    const first = html.slice(html.indexOf('id="vendor-suspension-vendor-1"'), html.indexOf('id="vendor-vendor-2"'));
    expect(first).toContain("凍結商家");
    expect(first).toContain('name="reason"');
    const second = html.slice(html.indexOf('id="vendor-suspension-vendor-2"'));
    expect(second).toContain("解除凍結");
    expect(second).toContain("合成：違規");
    expect(html).toContain("已凍結");
    // The step-up notice is rendered for the operation.
    expect(html).toContain("凍結或解除凍結商家");
  });

  it("offers a release retry only for an active vendor that still has held paid access", async () => {
    mocks.heldGroupBy.mockResolvedValue([{ vendorId: "vendor-2", _count: { _all: 3 } }]);
    const html = await render({});
    expect(html).not.toContain('id="vendor-release-vendor-1"');
    expect(html).toContain('id="vendor-release-vendor-2"');
    expect(html).toContain("有 3 筆已付款但尚未開通的權限");
  });

  it("shows a suspension result inside the focused vendor's card without the beta-module feedback", async () => {
    const html = await render({ suspension: "suspended", vendor: "vendor-1" });
    expect(html).toContain("已凍結商家");
    expect(html).not.toContain("data-feedback");
    expect(await render({ suspensionError: "reason_required" })).toContain("請填寫凍結原因");
  });
});
