import { describe, expect, it } from "vitest";
import { template } from "./09-career-value";
import { webinarTemplateIssues, webinarTemplateNodeSignature } from "./template-checks";

describe("webinar template: 09-career-value", () => {
  it("passes the shared template checks (qa-standards §5.3)", () => {
    expect(webinarTemplateIssues(template)).toEqual([]);
  });

  it("only displays prices: no product, offer price or payment nodes (specs/09 §11)", () => {
    const types = webinarTemplateNodeSignature(template).map((entry) => entry.split(":").at(-1));
    expect(types).not.toContain("offer_price");
    expect(types).not.toContain("payment_button");
    expect(JSON.stringify(template.build("check"))).not.toMatch(/productId|priceId|checkout/u);
  });

  it("keeps node ids, types and order stable", () => {
    expect(webinarTemplateNodeSignature(template)).toMatchSnapshot();
  });
});
