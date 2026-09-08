import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("customer CRM action security contract", () => {
  it("guards mutations with CSRF, manager auth and vendor-qualified writes", async () => {
    const source = await readFile(new URL("./customer-crm-actions.ts", import.meta.url), "utf8");
    expect(source.match(/assertServerActionSecurity\(formData\)/gu)?.length).toBe(6);
    expect(source.match(/requireVendorManagerContext\(\)/gu)?.length).toBe(6);
    expect(source).toContain("vendorId: vendor.id");
    expect(source).toContain("vendorId_customerKeyHash");
  });

  it("keeps notes append-only and attributes the authenticated actor", async () => {
    const source = await readFile(new URL("./customer-crm-actions.ts", import.meta.url), "utf8");
    expect(source).toContain("consultantNote.create");
    expect(source).not.toContain("consultantNote.update");
    expect(source).toContain("actorLabel: auth.member!.role");
    expect(source).toContain("$transaction(async (transaction)");
  });
});
