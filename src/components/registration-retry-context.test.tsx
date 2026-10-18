import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RegistrationRetryProvider } from "./registration-retry-context";
import { LeadForm } from "./lead-form";
const fields = [{ key: "name", label: "姓名", required: true, type: "text" }, { key: "email", label: "Email", required: true, type: "email" }];
const draft = { formId: "synthetic-form", sourcePath: "/form/synthetic", answers: { name: "合成<&姓名", email: "synthetic@example.test" }, liveId: "second", status: 429 as const };
const sessions = ["first", "second"].map((id) => ({ id, title: id, description: null, scheduledAt: "2026-10-12T00:00:00Z", status: "scheduled" as const }));
function markup(formId = draft.formId, retained = true) {
  return renderToStaticMarkup(<RegistrationRetryProvider value={{ formId: draft.formId, sourcePath: draft.sourcePath, draft: retained ? draft : null, failed: true }}><LeadForm formId={formId} fields={fields} sessions={sessions} submitLabel="報名" successMessage="已送出" /></RegistrationRetryProvider>);
}
describe("retry server rendered markup", () => {
  it("renders escaped values, selected session and error without JavaScript", () => {
    const html = markup();
    expect(html).toContain('name="__registrationReturnPath" value="/form/synthetic"');
    expect(html).toContain('value="合成&lt;&amp;姓名"');
    expect(html).toContain('value="synthetic@example.test"');
    expect(html).toMatch(/checked=""[^>]*value="second"/);
    expect(html).toContain("送出次數太頻繁");
    expect(html).toContain('role="alert"');
    expect(html).not.toContain("capability");
  });
  it("does not inject retry answers into another form", () => {
    expect(markup("other-form")).not.toContain('value="synthetic@example.test"');
    expect(markup("other-form")).not.toContain("送出次數太頻繁");
  });
  it("does not claim failure when no valid draft confirms the old URL", () => {
    const html = markup(draft.formId, false);
    expect(html).toContain("無法確認先前的送出結果");
    expect(html).toContain("避免重複送出");
    expect(html).not.toContain("這次資料未能送出");
    expect(html).not.toContain('value="synthetic@example.test"');
  });
});


it.each([[undefined, "/form/synthetic"], ["", "/form/synthetic"], ["/lp/next", "/lp/next"]])("preserves native success destination for redirect %s", (redirectTo, expected) => {
  const html = renderToStaticMarkup(<RegistrationRetryProvider value={{formId:draft.formId,sourcePath:draft.sourcePath,draft:null,failed:false}}><LeadForm formId={draft.formId} fields={fields} submitLabel="報名" successMessage="已送出" redirectTo={redirectTo} /></RegistrationRetryProvider>);
  expect(html).toContain(`name="redirectTo" value="${expected}"`);
});
