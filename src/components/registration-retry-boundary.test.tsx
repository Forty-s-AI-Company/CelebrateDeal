import { afterEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
const mocks = vi.hoisted(() => ({ get: vi.fn(() => undefined) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: mocks.get }), headers: async () => new Headers({ host: "app.example.test" }) }));
import { registrationRetryBoundary } from "./registration-retry-boundary";
import { LeadForm } from "./lead-form";
afterEach(() => vi.unstubAllEnvs());
it("keeps form editable when a shared URL claims success without proof", async () => {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.test");
  const wrap = await registrationRetryBoundary({formId:"synthetic-form",sourcePath:"/form/synthetic",submitted:"verification_required"});
  const html = renderToStaticMarkup(wrap(<LeadForm formId="synthetic-form" fields={[{key:"email",type:"email",label:"Email",required:true}]} submitLabel="報名" successMessage="已送出" />));
  expect(html).toContain('name="email"');expect(html).not.toContain('disabled=""');expect(html).not.toContain("已送出");
});

it.each(["400", "403", "404", "429", "503", "unavailable"])("shared error URL %s does not prove submission failure", async (retry) => {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.test");
  const wrap = await registrationRetryBoundary({formId:"synthetic-form",sourcePath:"/form/synthetic",retry});
  const html = renderToStaticMarkup(wrap(<LeadForm formId="synthetic-form" fields={[{key:"email",type:"email",label:"Email",required:true}]} submitLabel="報名" successMessage="已送出" />));
  expect(html).toContain("無法確認先前的送出結果");
  expect(html).not.toContain("這次資料未能送出");
  expect(html).not.toContain('disabled=""');
});

it("server-renders native attribution fields without browser-derived initial state", async () => {
  const wrap = await registrationRetryBoundary({ formId: "synthetic-form", sourcePath: "/form/synthetic", attributionQuery: { ref: "synthetic-ref", share: `tls1.${"a".repeat(32)}`, lp: "synthetic-page" } });
  const html = renderToStaticMarkup(wrap(<LeadForm formId="synthetic-form" fields={[{ key: "email", label: "Email" }]} submitLabel="送出" successMessage="完成" />));
  expect(html).toContain('name="referralCode" value="synthetic-ref"');
  expect(html).toContain('name="landingPageId" value="synthetic-page"');
  expect(html).toContain(`name="shareCode" value="tls1.${"a".repeat(32)}"`);
});
