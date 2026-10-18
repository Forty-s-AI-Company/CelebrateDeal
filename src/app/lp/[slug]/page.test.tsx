import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
const mocks = vi.hoisted(() => ({ load: vi.fn(), runtime: vi.fn(), recordVisit: vi.fn(), readDraft: vi.fn(), verifyResult: vi.fn() }));
vi.mock("@/lib/registration-form-retry", async (original) => ({ ...await original<typeof import("@/lib/registration-form-retry")>(), readRegistrationRetryDraft: mocks.readDraft }));
vi.mock("@/lib/registration-submission-receipt", async (original) => ({ ...await original<typeof import("@/lib/registration-submission-receipt")>(), verifyRegistrationResult: mocks.verifyResult }));
vi.mock("@/lib/landing-page-service", () => ({ loadPublicLandingPage: mocks.load }));
vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers({host:"app.example.test"})), cookies: vi.fn(async () => ({ get: () => ({ value: "visitor-12345678901234567890" }) })) }));
vi.mock("@/lib/funnel-runtime", () => ({
  FUNNEL_VISITOR_COOKIE: "celebratedeal_funnel_visitor",
  resolveFunnelVisitorId: vi.fn((value) => value),
  resolvePublicFunnelRuntime: mocks.runtime,
  recordPublicFunnelVisit: mocks.recordVisit,
}));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("@/components/landing-pages/landing-page-renderer", () => ({ LandingPageRenderer: ({ content }: { content: { data: { root: { props: { title: string } } } } }) => <main>{content.data.root.props.title}</main> }));
vi.mock("@/components/landing-pages/funnel-webinar-experience", async () => {
  const { useRegistrationRetry } = await import("@/components/registration-retry-context");
  return { FunnelWebinarExperience: function WebinarProbe({ stepId, resource }: { stepId: string; resource?: { form: { id: string } } }) {
    const retry = useRegistrationRetry(resource?.form.id ?? "");
    return <main data-resource={Boolean(resource)} data-return-path={retry?.sourcePath ?? ""}>{stepId}</main>;
  } };
});
import { createFunnelFlow } from "@/lib/funnel-flow";
import { createEmptyPageDocument, FunnelNodeSchema } from "@/lib/funnel-page-document";
import { createFunnelStepPages } from "@/lib/funnel-step-pages";
import PublicStepPage from "./[stepPath]/page";
import PublicPage, { generateMetadata } from "./page";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.readDraft.mockReset();
  mocks.verifyResult.mockReset();
  mocks.runtime.mockImplementation(async ({ pageId, requestedStepId }) => ({
    page: { id: pageId, vendorId: "vendor-1", operations: null },
    decision: { status: "render", requestedStepId, renderedStepId: requestedStepId, experiment: null },
  }));
});
describe("published landing route", () => {
  it("renders only the published snapshot and its SEO metadata", async () => {
    mocks.load.mockResolvedValue({ id: "page1", content: { schemaVersion: 1, data: { root: { props: { title: "已發布標題", description: "活動說明", shareImage: "https://cdn.example.test/share.png" } }, content: [] } }, context: { forms: [] } });
    const params = Promise.resolve({ slug: "webinar" });
    expect(renderToStaticMarkup(await PublicPage({ params }))).toContain("已發布標題");
    expect(await generateMetadata({ params })).toMatchObject({ title: "已發布標題", description: "活動說明", openGraph: { images: ["https://cdn.example.test/share.png"] } });
    expect(mocks.load).toHaveBeenCalledWith("webinar");
  });
  it("does not expose unavailable pages or index their metadata", async () => {
    mocks.load.mockResolvedValue(null);
    const params = Promise.resolve({ slug: "draft" });
    await expect(PublicPage({ params })).rejects.toThrow("NOT_FOUND");
    expect(await generateMetadata({ params })).toMatchObject({ robots: { index: false, follow: false } });
  });
});


it("routes a published Webinar to the registration and broadcast experiences", async () => {
  const content = createFunnelStepPages(createFunnelFlow({ id: "webinar", name: "Webinar", goal: "webinar", domain: "webinar" })!)!;
  mocks.load.mockResolvedValue({ id: "page1", slug: "webinar", content, context: { forms: [] } });
  expect(renderToStaticMarkup(await PublicPage({ params: Promise.resolve({ slug: "webinar" }) }))).toContain("webinar_registration");
  expect(renderToStaticMarkup(await PublicStepPage({ params: Promise.resolve({ slug: "webinar", stepPath: "broadcast" }) }))).toContain("webinar_broadcast");
  await expect(PublicStepPage({ params: Promise.resolve({ slug: "webinar", stepPath: "foreign" }) })).rejects.toThrow("NOT_FOUND");
});


it("binds webinar retry to its rendered form even when a different generic form exists", async () => {
  const content = createFunnelStepPages(createFunnelFlow({ id: "webinar", name: "Webinar", goal: "webinar", domain: "webinar" })!)!;
  mocks.load.mockResolvedValue({ id: "page1", slug: "webinar", content, context: { forms: [] }, submissionForm: { id: "generic-form" }, webinar: { form: { id: "webinar-form" } } });
  const root = renderToStaticMarkup(await PublicPage({ params: Promise.resolve({ slug: "webinar" }) }));
  expect(root).toContain('data-return-path="/lp/webinar"');
  const step = renderToStaticMarkup(await PublicStepPage({ params: Promise.resolve({ slug: "webinar", stepPath: "broadcast" }) }));
  expect(step).toContain('data-return-path="/lp/webinar/broadcast"');
});


it("uses the canonical published slug for a mixed-case incoming step URL", async () => {
  const content = createFunnelStepPages(createFunnelFlow({ id: "webinar", name: "Webinar", goal: "webinar", domain: "webinar" })!)!;
  mocks.load.mockResolvedValue({ id:"page1",slug:"webinar",content,context:{forms:[]},webinar:{form:{id:"webinar-form"}} });
  const html = renderToStaticMarkup(await PublicStepPage({params:Promise.resolve({slug:"Webinar",stepPath:"broadcast"})}));
  expect(html).toContain('data-return-path="/lp/webinar/broadcast"');
  expect(html).not.toContain('/lp/Webinar/');
});

it.each(["closed", "redirect"] as const)("keeps a readonly result on both expired entrances for %s", async (status) => {
 const content = createFunnelStepPages(createFunnelFlow({id:"webinar",name:"Webinar",goal:"webinar",domain:"webinar"})!)!;
 mocks.load.mockResolvedValue({id:"page1",slug:"webinar",content,context:{forms:[]},webinar:{form:{id:"webinar-form",fields:[{key:"email",label:"Email"}]}}});
 mocks.runtime.mockResolvedValue({page:{id:"page1",vendorId:"vendor-1"},decision:{status,path:"thank-you"}});
 const query=Promise.resolve({registrationRetry:"unavailable"});
 const views=[await PublicPage({params:Promise.resolve({slug:"webinar"}),searchParams:query}),await PublicStepPage({params:Promise.resolve({slug:"webinar",stepPath:"broadcast"}),searchParams:query})];
 for(const view of views){const html=renderToStaticMarkup(view);expect(html).toContain("此活動已截止");expect(html).toContain("無法確認先前的送出結果");expect(html).not.toContain("<form");if(status==="redirect")expect(html).toContain('/lp/webinar/thank-you');}
 expect(mocks.recordVisit).not.toHaveBeenCalled();
});

it.each([null, {decision:{status:"unavailable"}}])("checks runtime availability before reading any retry evidence", async (runtime) => {
 const content=createFunnelStepPages(createFunnelFlow({id:"webinar",name:"Webinar",goal:"webinar",domain:"webinar"})!)!;
 mocks.load.mockResolvedValue({id:"page1",slug:"webinar",content,context:{forms:[]},webinar:{form:{id:"webinar-form",fields:[]}}});
 mocks.runtime.mockResolvedValue(runtime);
 const searchParams=Promise.resolve({registrationRetry:"429",submitted:"verification_required"});
 await expect(PublicPage({params:Promise.resolve({slug:"webinar"}),searchParams})).rejects.toThrow("NOT_FOUND");
 await expect(PublicStepPage({params:Promise.resolve({slug:"webinar",stepPath:"broadcast"}),searchParams})).rejects.toThrow("NOT_FOUND");
 expect(mocks.readDraft).not.toHaveBeenCalled();expect(mocks.verifyResult).not.toHaveBeenCalled();
});

it.each(["closed", "redirect"] as const)("renders bound draft and verified success on both expired entrances: %s", async (status) => {
 const content=createFunnelStepPages(createFunnelFlow({id:"webinar",name:"Webinar",goal:"webinar",domain:"webinar"})!)!;
 mocks.load.mockResolvedValue({id:"page1",slug:"webinar",content,context:{forms:[]},webinar:{form:{id:"webinar-form",fields:[{key:"email",label:"Email"}]}}});
 mocks.runtime.mockResolvedValue({page:{id:"page1",vendorId:"vendor-1"},decision:{status,path:"thank-you"}});
 for(const step of [false,true]) {
  const sourcePath=step?"/lp/webinar/broadcast":"/lp/webinar";
  mocks.readDraft.mockResolvedValue({formId:"webinar-form",sourcePath,answers:{email:"synthetic@example.test"},liveId:null,status:429});
  const renderPage=(query: {registrationRetry?:string;submitted?:string})=>step?PublicStepPage({params:Promise.resolve({slug:"webinar",stepPath:"broadcast"}),searchParams:Promise.resolve(query)}):PublicPage({params:Promise.resolve({slug:"webinar"}),searchParams:Promise.resolve(query)});
  const failed=renderToStaticMarkup(await renderPage({registrationRetry:"429"}));
  expect(failed).toContain('value="synthetic@example.test"');expect(failed).toContain('readOnly=""');expect(failed).not.toContain("<form");
  expect(mocks.readDraft).toHaveBeenLastCalledWith(expect.anything(),expect.objectContaining({formId:"webinar-form",sourcePath}));
  mocks.verifyResult.mockReturnValue(true);
  const success=renderToStaticMarkup(await renderPage({submitted:"verification_required"}));
  expect(success).toContain("請到 Email 開啟確認連結");expect(success).not.toContain("<input");expect(success).not.toContain("<form");
  expect(mocks.verifyResult).toHaveBeenLastCalledWith(expect.any(String),"webinar-form",sourcePath);
 }
});

it("reads the single-use draft only when the rendered Webinar step shows the registration form", async () => {
  const content = createFunnelStepPages(createFunnelFlow({ id: "webinar", name: "Webinar", goal: "webinar", domain: "webinar" })!)!;
  mocks.load.mockResolvedValue({ id: "page1", slug: "webinar", content, context: { forms: [] }, webinar: { form: { id: "webinar-form" } } });
  mocks.readDraft.mockResolvedValue(null);
  const searchParams = () => Promise.resolve({ registrationRetry: "429" });
  await PublicStepPage({ params: Promise.resolve({ slug: "webinar", stepPath: "broadcast" }), searchParams: searchParams() });
  expect(mocks.readDraft).not.toHaveBeenCalled();
  // A runtime decision that renders another step than requested decides, not the URL.
  const registration = content.flow.steps.find((step) => step.type === "webinar_registration_page")!;
  const broadcast = content.flow.steps.find((step) => step.type === "webinar_broadcast_page")!;
  mocks.runtime.mockResolvedValueOnce({ page: { id: "page1", vendorId: "vendor-1" }, decision: { status: "render", requestedStepId: registration.id, renderedStepId: broadcast.id, experiment: null } });
  await PublicPage({ params: Promise.resolve({ slug: "webinar" }), searchParams: searchParams() });
  expect(mocks.readDraft).not.toHaveBeenCalled();
  await PublicPage({ params: Promise.resolve({ slug: "webinar" }), searchParams: searchParams() });
  expect(mocks.readDraft).toHaveBeenCalledOnce();
});

it("reads the single-use draft for a page document only when it renders a lead form", async () => {
  mocks.readDraft.mockResolvedValue(null);
  const searchParams = () => Promise.resolve({ registrationRetry: "400" });
  const withoutForm = createEmptyPageDocument();
  mocks.load.mockResolvedValueOnce({ id: "page1", slug: "lead", content: withoutForm, context: { forms: [] }, submissionForm: { id: "form", fields: [], submitLabel: "送出", successMessage: "ok" } });
  await PublicPage({ params: Promise.resolve({ slug: "lead" }), searchParams: searchParams() });
  expect(mocks.readDraft).not.toHaveBeenCalled();
  const withForm = createEmptyPageDocument();
  withForm.root = [FunnelNodeSchema.parse({ schemaVersion: 1, id: "lead", type: "form" })];
  mocks.load.mockResolvedValueOnce({ id: "page1", slug: "lead", content: withForm, context: { forms: [] }, submissionForm: { id: "form", fields: [], submitLabel: "送出", successMessage: "ok" } });
  await PublicPage({ params: Promise.resolve({ slug: "lead" }), searchParams: searchParams() });
  expect(mocks.readDraft).toHaveBeenCalledOnce();
  const checkoutContact = createEmptyPageDocument();
  checkoutContact.root = [FunnelNodeSchema.parse({ schemaVersion: 1, id: "contact", type: "form", props: { variant: "checkout-contact" } })];
  mocks.load.mockResolvedValueOnce({ id: "page1", slug: "lead", content: checkoutContact, context: { forms: [] }, submissionForm: { id: "form", fields: [], submitLabel: "送出", successMessage: "ok" } });
  await PublicPage({ params: Promise.resolve({ slug: "lead" }), searchParams: searchParams() });
  expect(mocks.readDraft).toHaveBeenCalledOnce();
});

