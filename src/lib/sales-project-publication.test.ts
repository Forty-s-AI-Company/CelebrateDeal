import { beforeEach, describe, expect, it, vi } from "vitest";
import { publishOwnedSalesProject } from "./sales-project-publication";

const db = { salesProject: { findFirst: vi.fn(), updateMany: vi.fn() }, salesProjectProduct: { count: vi.fn() }, registrationForm: { count: vi.fn() }, live: { count: vi.fn() }, consultationEvent: { findMany: vi.fn() }, paymentMethodReference: { count: vi.fn() } };
beforeEach(() => {
  vi.resetAllMocks();
  db.salesProject.findFirst.mockResolvedValue({ id: "project", primaryFlow: "live" });
  db.salesProject.updateMany.mockResolvedValue({ count: 1 });
  db.salesProjectProduct.count.mockResolvedValue(1); db.registrationForm.count.mockResolvedValue(1); db.live.count.mockResolvedValue(1); db.consultationEvent.findMany.mockResolvedValue([]); db.paymentMethodReference.count.mockResolvedValue(1);
});
describe("unchanged project release requirements", () => {
  it("retains the exact owned valid verified payment predicate and priced product requirement", async () => {
    expect(await publishOwnedSalesProject(db as never, "vendor", "project")).toEqual({ status: "published" });
    expect(db.paymentMethodReference.count).toHaveBeenCalledWith({ where: { vendorId: "vendor", scopeType: "VENDOR", membershipId: null, status: "verified", verifiedAt: { not: null, lte: expect.any(Date) }, OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }] } });
    expect(db.salesProjectProduct.count).toHaveBeenCalledWith({ where: { vendorId: "vendor", projectId: "project", product: { isActive: true, priceCents: { gt: 0 } } } });
    expect(db.salesProject.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "project", vendorId: "vendor", status: { not: "archived" } } }));
  });
  it.each(["product", "form", "live", "verified payment"])("does not publish without %s", async missing => {
    ({ product: db.salesProjectProduct.count, form: db.registrationForm.count, live: db.live.count, "verified payment": db.paymentMethodReference.count }[missing]!).mockResolvedValue(0);
    expect(await publishOwnedSalesProject(db as never, "vendor", "project")).toEqual({ status: "not_ready" });
    expect(db.salesProject.updateMany).not.toHaveBeenCalled();
  });
  it("does not read other tenant setup or update a missing project", async () => {
    db.salesProject.findFirst.mockResolvedValue(null);
    expect(await publishOwnedSalesProject(db as never, "vendor", "foreign")).toEqual({ status: "not_found" });
    expect(db.paymentMethodReference.count).not.toHaveBeenCalled();
  });
  it("does not claim publication when the conditional update loses its target", async () => {
    db.salesProject.updateMany.mockResolvedValue({ count: 0 });
    expect(await publishOwnedSalesProject(db as never, "vendor", "project")).toEqual({ status: "not_ready" });
  });
});
