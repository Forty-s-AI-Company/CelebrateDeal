import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RegistrationSubmissionFeedback } from "./registration-submission-feedback";

describe("registration feedback announcements", () => {
  it("keeps empty alert and status regions mounted before submission", () => {
    const html = renderToStaticMarkup(<RegistrationSubmissionFeedback pending={false} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain('role="status"');
    expect(html).toContain('tabindex="-1"');
  });
  it("only announces progress while a previous error is being retried", () => {
    const html = renderToStaticMarkup(<RegistrationSubmissionFeedback pending errorMessage="previous error" successMessage="old success" />);
    expect(html).toContain("正在送出");
    expect(html).not.toContain("previous error");
    expect(html).not.toContain("old success");
  });
  it("announces the error without concurrent success or progress text", () => {
    const html = renderToStaticMarkup(<RegistrationSubmissionFeedback pending={false} errorMessage="請稍後重試" successMessage="old success" />);
    expect(html).toContain("請稍後重試");
    expect(html).not.toContain("old success");
    expect(html).not.toContain("正在送出");
    expect(html).toContain('aria-live="assertive"');
  });
  it("announces success once through the polite region", () => {
    const html = renderToStaticMarkup(<RegistrationSubmissionFeedback pending={false} successMessage="已收到" />);
    expect(html.match(/已收到/g)).toHaveLength(1);
    expect(html).toContain('aria-live="polite"');
  });
});
