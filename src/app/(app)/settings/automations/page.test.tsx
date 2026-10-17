import { renderToStaticMarkup } from "react-dom/server"; import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ owner: vi.fn(), products: vi.fn(), rules: vi.fn(), logs: vi.fn() })); vi.mock("@/lib/auth", () => ({ requireVendorOwner: mocks.owner })); vi.mock("@/lib/db", () => ({ getDb: () => ({ product: { findMany: mocks.products }, automationRule: { findMany: mocks.rules }, automationExecutionLog: { findMany: mocks.logs } }) })); vi.mock("@/app/actions/automation-actions", () => ({ createAutomationRuleAction: vi.fn(), createAutomationRecipeAction: vi.fn(), dryRunAutomationRuleAction: vi.fn(), toggleAutomationRuleAction: vi.fn() })); vi.mock("@/components/csrf-field", () => ({ CsrfField: () => <input type="hidden" name="csrf" /> }));
import Page from "./page";
beforeEach(() => { vi.clearAllMocks(); mocks.owner.mockResolvedValue({ vendor: { id: "v1" } }); mocks.products.mockResolvedValue([{ id: "p1", name: "課程" }]); mocks.rules.mockResolvedValue([{ id: "r1", name: "付款回購", trigger: "payment_paid", condition: { type: "order_amount_gte", amountCents: 10000 }, actions: [{ type: "line_push" }], isActive: true, createdAt: new Date("2026-01-01") }]); mocks.logs.mockResolvedValue([{ id: "l1", rule: { name: "付款回購" }, trigger: "payment_paid", subjectKeyHash: "abcdefgh12345678", status: "failed", errorCode: "action_failed", createdAt: new Date("2026-01-02") }]); });
describe("AutomationSettingsPage", () => { it("renders recipes, visual rules, dry-run and masked logs", async () => { const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) })); expect(mocks.rules).toHaveBeenCalledWith(expect.objectContaining({ where: { vendorId: "v1" } })); expect(html).toMatch(/<h1[^>]*>自動化<\/h1>/); expect(html).toContain("高意向追單漏斗"); expect(html).toContain("Dry-run 測試"); expect(html).toContain("abcd…5678"); expect(html).toContain("action_failed"); expect(html).toContain("LINE 推播訊息"); }); });

it('shows all three one-click drafts and marks unfinished rules non-activatable',async()=>{
 mocks.rules.mockResolvedValue([{id:'draft1',name:'結帳草稿',trigger:'checkout_incomplete',condition:{type:'order_pending_payment'},actions:[{type:'send_email_notification'}],isActive:false,createdAt:new Date('2026-01-01')}]);
 const html=renderToStaticMarkup(await Page({searchParams:Promise.resolve({})}));
 for(const title of ['未到場追銷','看完未下單追銷','結帳未完成追銷'])expect(html).toContain(title);
 expect(html.match(/一鍵建立草稿/g)).toHaveLength(3);expect(html).toContain('尚不可啟用');expect(html).toContain('disabled=""');
 expect(html).not.toContain('<option value="checkout_incomplete"');expect(html).not.toContain('<option value="viewer_completed"');
 expect(html).toContain('訂單仍待付款');
});
it('explains a blocked activation without displaying an opaque error code',async()=>{
 const html=renderToStaticMarkup(await Page({searchParams:Promise.resolve({error:'trigger_not_ready'})}));
 expect(html).toContain('規則條件與範本不相符，請重新建立追銷範本。');expect(html).not.toContain('規則無法更新（trigger_not_ready）');
});

it.each([{trigger:'viewer_completed',condition:{type:'completed_and_not_ordered'},template:'completed_followup'},{trigger:'checkout_incomplete',condition:{type:'order_pending_payment'},template:'checkout_followup'}])('shows a usable activation button for exact $trigger recipes and explains real-source checks',async recipe=>{
 mocks.rules.mockResolvedValue([{id:'ready1',name:'追銷草稿',trigger:recipe.trigger,condition:recipe.condition,actions:[{type:'send_email_notification',template:recipe.template}],isActive:false,funnelPageId:null,createdAt:new Date('2026-01-01')}]);
 const html=renderToStaticMarkup(await Page({searchParams:Promise.resolve({})}));expect(html).not.toContain('尚不可啟用');expect(html).not.toContain('disabled=""');expect(html).toMatch(/>啟用<\/button>/);expect(html).toContain('依實際觀看與訂單紀錄');expect(html).not.toContain('模擬觀看（秒）');expect(html).not.toContain('<option value="checkout_incomplete"');expect(html).not.toContain('<option value="viewer_completed"');
});

it('flags an incompatible active trusted rule while still offering deactivation',async()=>{
 mocks.rules.mockResolvedValue([{id:'invalid-active',name:'舊追銷設定',trigger:'viewer_completed',condition:{type:'always'},actions:[{type:'line_push',message:'legacy'}],isActive:true,createdAt:new Date('2026-01-01')}]);
 const html=renderToStaticMarkup(await Page({searchParams:Promise.resolve({})}));expect(html).toContain('設定待重建');expect(html).not.toContain('啟用中');expect(html).toMatch(/>停用<\/button>/);
});
