import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("mobile consultation action contract", () => {
  it("guards the write and derives customer identity from a tenant-qualified booking", async () => {
    const source = await readFile(new URL("./mobile-consultation-actions.ts", import.meta.url), "utf8");
    expect(source).toContain("assertServerActionSecurity(formData)");
    expect(source).toContain("requireVendorManagerContext()");
    expect(source).toContain("where: { id: bookingId, vendorId: vendor.id }");
    expect(source).toContain("booking.customerKeyHash");
    expect(source).not.toContain('text(formData, "customerKeyHash")');
  });

  it("uses one transaction for append-only notes, allowlisted tags and closed_won", async () => {
    const source = await readFile(new URL("./mobile-consultation-actions.ts", import.meta.url), "utf8");
    expect(source).toContain("database.$transaction");
    expect(source).toContain("consultantNote.create");
    expect(source).not.toContain("consultantNote.update");
    expect(source).toContain('z.enum(["預算足夠", "需再跟進"])');
    expect(source).toContain('consultationStatus: "closed_won"');
  });
});
