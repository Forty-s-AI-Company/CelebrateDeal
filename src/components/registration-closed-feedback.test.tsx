import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { RegistrationRetryProvider } from "./registration-retry-context";
import { RegistrationClosedFeedback } from "./registration-closed-feedback";
const draft = { formId: "synthetic", sourcePath: "/lp/synthetic", answers: { name: "合成<&姓名", unknown: "not-a-current-field" }, liveId: null, status: 429 as const };
function render(formId = "synthetic", retained = true, submitted = false) {
 return renderToStaticMarkup(<RegistrationRetryProvider value={{formId:"synthetic",sourcePath:draft.sourcePath,draft:retained?draft:null,failed:true,submitted}}><RegistrationClosedFeedback formId={formId} fields={[{key:"name",label:"姓名"}]} destination="/lp/synthetic/thank-you" /></RegistrationRetryProvider>);
}
it("shows only bound, current fields as escaped readonly values without submission controls", () => {
 const html = render(); expect(html).toContain('value="合成&lt;&amp;姓名"');expect(html).toContain('readOnly=""');
 expect(html).not.toContain("not-a-current-field");expect(html).not.toContain("<form");expect(html).not.toContain("<button");expect(html).not.toContain('name="');
 expect(html).toContain('href="/lp/synthetic/thank-you"');
});
it.each([["other",true],["synthetic",false]])("does not expose unbound or missing draft", (id, retained) => {
 const html=render(id,retained);expect(html).not.toContain("合成");expect(html).toContain("無法確認先前的送出結果");
});
it("gives verified success priority over old failure content", () => {
 const html=render("synthetic",true,true);expect(html).toContain("請到 Email 開啟確認連結");expect(html).not.toContain("先前送出未完成");expect(html).not.toContain("<input");
});
