import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("manual customer voucher action contract", () => {
  it("keeps the mutation behind CSRF, manager auth and an editable sales project", async () => {
    const source = await readFile(new URL("./customer-crm-actions.ts", import.meta.url), "utf8");
    expect(source).toContain("assertServerActionSecurity(formData)");
    expect(source).toContain("requireVendorManagerContext()");
    expect(source).toContain("requireEditableSalesProjectScope(auth.user.id, vendor.id)");
    expect(source).toContain("vendorId_projectId_customerKeyHash");
    expect(source).toContain("salesProjectLinks");
  });

  it("uses tenant and project filters before resolving recipient PII", async () => {
    const source = await readFile(new URL("./customer-crm-actions.ts", import.meta.url), "utf8");
    expect(source).toContain("form: { vendorId: vendor.id, ...projectForm }");
    expect(source).toContain("event: projectEvent");
    expect(source).toContain("automationCustomerKeyHash(vendor.id");
    expect(source).toContain("revealCommerceOrderPii");
    expect(source).toContain("db.$transaction(async (transaction)");
  });
});
