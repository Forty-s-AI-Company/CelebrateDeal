import { describe, expect, it } from "vitest";
import { createCourseCertificate } from "@/lib/course-certificate";

describe("course certificate", () => {
  const input = { vendorName: "五和學院", studentName: "王小明", courseName: "高客單成交實戰", completedAt: new Date("2026-09-09T04:00:00Z"), customerKeyHash: "opaque-learner-key", courseId: "course-1" };

  it("generates deterministic SVG artwork with certificate data but never the opaque learner key", () => {
    const first = createCourseCertificate(input);
    const second = createCourseCertificate(input);
    expect(first.verificationNumber).toBe(second.verificationNumber);
    expect(first.verificationNumber).toMatch(/^CD-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}$/u);
    expect(first.svg).toContain("王小明");
    expect(first.svg).toContain("高客單成交實戰");
    expect(first.svg).not.toContain("opaque-learner-key");
  });

  it("escapes learner-controlled display text before putting it in SVG", () => {
    const certificate = createCourseCertificate({ ...input, studentName: '<script>alert("x")</script>' });
    expect(certificate.svg).toContain("&lt;script&gt;");
    expect(certificate.svg).not.toContain("<script>");
  });
});
