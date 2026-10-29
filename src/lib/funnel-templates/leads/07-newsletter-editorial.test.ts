import { describe, expect, it } from "vitest";
import { template } from "./07-newsletter-editorial";
import { conversionTemplateIssues, conversionTemplateNodeSignature } from "../conversion/template-checks";

describe("leads template: 07-newsletter-editorial", () => {
  it("passes the shared template checks", () => {
    expect(template).not.toBeNull();
    expect(conversionTemplateIssues(template!)).toEqual([]);
  });

  it("keeps node ids, types and order stable (page and thank-you page)", () => {
    expect(conversionTemplateNodeSignature(template!)).toMatchSnapshot();
  });
});
