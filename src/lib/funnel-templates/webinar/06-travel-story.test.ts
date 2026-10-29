import { describe, expect, it } from "vitest";
import { template } from "./06-travel-story";
import { webinarTemplateIssues, webinarTemplateNodeSignature } from "./template-checks";

describe("webinar template: 06-travel-story", () => {
  it("passes the shared template checks (qa-standards §5.3)", () => {
    expect(webinarTemplateIssues(template)).toEqual([]);
  });

  it("keeps node ids, types and order stable", () => {
    expect(webinarTemplateNodeSignature(template)).toMatchSnapshot();
  });
});
