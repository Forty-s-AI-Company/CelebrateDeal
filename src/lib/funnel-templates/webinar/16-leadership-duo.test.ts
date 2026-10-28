import { describe, expect, it } from "vitest";
import { template } from "./16-leadership-duo";
import { webinarTemplateIssues, webinarTemplateNodeSignature } from "./template-checks";

// 範本工作階段：複製這個檔案成 NN-<slug>.test.ts，把 import 換成自己的範本。
describe("webinar template: 16-leadership-duo", () => {
  it("passes the shared template checks (qa-standards §5.3)", () => {
    expect(webinarTemplateIssues(template)).toEqual([]);
  });

  it("keeps node ids, types and order stable", () => {
    expect(webinarTemplateNodeSignature(template)).toMatchSnapshot();
  });
});
