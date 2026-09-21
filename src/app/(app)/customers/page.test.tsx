import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("customer CRM page contract", () => {
  it("exposes search, KPI cards, masked contacts and the 360-degree detail route", async () => {
    const source = await readFile(new URL("./page.tsx", import.meta.url), "utf8");
    expect(source).toContain("成交轉換率");
    expect(source).toContain("CustomerCrmWorkbench");
    expect(source).toContain("CsrfField");
    expect(source).not.toContain("searchParams");
    const workbench = await readFile(new URL("../../../components/customer-crm-workbench.tsx", import.meta.url), "utf8");
    expect(workbench).toContain("搜尋姓名、Email 或電話");
    expect(workbench).toContain("maskedEmail");
    expect(workbench).toContain("action={action}");
    expect(workbench).toContain("/customers/");
  });
});
