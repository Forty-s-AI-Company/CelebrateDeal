import { describe, expect, it } from "vitest";
import { template } from "./07-tripwire-mealprep";
import { conversionTemplateIssues, conversionTemplateNodeSignature } from "../conversion/template-checks";

describe("sales template: 07-tripwire-mealprep", () => {
  it("passes the shared template checks", () => {
    expect(template).not.toBeNull();
    expect(conversionTemplateIssues(template!)).toEqual([]);
  });

  it("keeps node ids, types and order stable (page and thank-you page)", () => {
    expect(conversionTemplateNodeSignature(template!)).toMatchSnapshot();
  });
});
