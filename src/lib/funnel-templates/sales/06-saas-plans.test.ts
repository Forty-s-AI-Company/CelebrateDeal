import { describe, expect, it } from "vitest";
import { template } from "./06-saas-plans";
import { conversionTemplateIssues, conversionTemplateNodeSignature } from "../conversion/template-checks";

describe("sales template: 06-saas-plans", () => {
  it("passes the shared template checks", () => {
    expect(template).not.toBeNull();
    expect(conversionTemplateIssues(template!)).toEqual([]);
  });

  it("keeps node ids, types and order stable (page and thank-you page)", () => {
    expect(conversionTemplateNodeSignature(template!)).toMatchSnapshot();
  });
});
