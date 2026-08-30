import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { buildFormSubmissionRequestBody, formSubmissionErrorMessage, getSubmittedLiveId, LeadForm } from "./lead-form";

describe("LeadForm", () => {
  it("renders supported field types with mobile keyboards and accessible async state", () => {
    const html = renderToStaticMarkup(
      <LeadForm
        formId="form-1"
        fields={[
          { key: "name", label: "姓名", type: "text", required: true },
          { key: "email", label: "Email", type: "email", required: true },
          { key: "phone", label: "電話", type: "tel" },
          { key: "guests", label: "人數", type: "number" },
          { key: "website", label: "網站", type: "url" },
        ]}
        submitLabel="送出報名"
        successMessage="完成"
      />,
    );

    expect(html).toContain('autoComplete="name"');
    expect(html).toContain('inputMode="email"');
    expect(html).toContain('inputMode="tel"');
    expect(html).toContain('inputMode="decimal"');
    expect(html).toContain('inputMode="url"');
    expect(html).toContain('aria-busy="false"');
    expect(html).toContain('role="status"');
  });

  it("renders required public sessions without a hidden live id", () => {
    const html = renderToStaticMarkup(
      <LeadForm
        formId="form-1"
        fields={[{ key: "name", label: "姓名", required: true }]}
        sessions={[
          { id: "live-1", title: "第一場", description: "說明", scheduledAt: "2026-08-20T01:00:00.000Z", status: "scheduled" },
          { id: "live-2", title: "回放場", description: null, scheduledAt: "2026-08-19T01:00:00.000Z", status: "ended" },
        ]}
        submitLabel="送出報名"
        successMessage="完成"
      />,
    );

    expect((html.match(/name="liveId"/g) ?? []).length).toBe(2);
    expect(html).toContain('value="live-1"');
    expect(html).toContain('value="live-2"');
    expect(html).not.toContain('type="hidden" name="liveId"');
    expect(html).toContain("回放場");
  });

  it("takes a selected live id from FormData and falls back to direct live links", () => {
    const selected = new FormData();
    selected.set("liveId", "selected-live");
    expect(getSubmittedLiveId(selected, "direct-live")).toBe("selected-live");

    const direct = new FormData();
    expect(getSubmittedLiveId(direct, "direct-live")).toBe("direct-live");
  });

  it("maps server and network failures to actionable messages without exposing internals", () => {
    expect(formSubmissionErrorMessage(400)).toContain("資料格式");
    expect(formSubmissionErrorMessage(429)).toContain("太頻繁");
    expect(formSubmissionErrorMessage(503)).toContain("無法接收");
    expect(formSubmissionErrorMessage()).toContain("內容仍保留");
  });

  it("omits an empty share code so ordinary public forms satisfy the API schema", () => {
    const ordinary = buildFormSubmissionRequestBody({
      formId: "form-1",
      payload: { name: "Lead", email: "lead@example.test" },
      referralCode: null,
      shareCode: "",
    });
    const shared = buildFormSubmissionRequestBody({
      formId: "form-1",
      liveId: "live-1",
      payload: { name: "Lead", email: "lead@example.test" },
      referralCode: null,
      shareCode: `tls1.${"a".repeat(43)}`,
    });

    expect(ordinary).not.toHaveProperty("shareCode");
    expect(shared).toHaveProperty("shareCode", `tls1.${"a".repeat(43)}`);
  });
});
