import { beforeEach, describe, expect, it, vi } from "vitest";
const runtime = vi.hoisted(() => ({ db: { product: { findFirst: vi.fn() }, automationRule: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() } }, auth: { vendor: { id: "v1" }, user: { id: "u1" }, member: { role: "owner" } }, security: vi.fn(), owner: vi.fn(), audit: vi.fn(), revalidate: vi.fn(), redirect: vi.fn((path: string): never => { throw new Error(`redirect:${path}`); }) }));
vi.mock("next/cache", () => ({ revalidatePath: runtime.revalidate })); vi.mock("next/navigation", () => ({ redirect: runtime.redirect })); vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: runtime.security })); vi.mock("@/lib/auth", () => ({ requireVendorOwner: runtime.owner })); vi.mock("@/lib/db", () => ({ getDb: () => runtime.db })); vi.mock("@/lib/audit", () => ({ auditSnapshot: (v: unknown) => v, writeAuditLog: runtime.audit }));
import { createAutomationRecipeAction, createAutomationRuleAction, dryRunAutomationRuleAction, toggleAutomationRuleAction } from "./automation-actions";
function form() { const f = new FormData(); f.set("name", "付款回購"); f.set("trigger", "payment_paid"); f.set("conditionValue", "100"); f.set("actionLine", "on"); f.set("lineMessage", "謝謝購買"); return f; }
beforeEach(() => { vi.clearAllMocks(); runtime.owner.mockResolvedValue(runtime.auth); runtime.db.automationRule.updateMany.mockResolvedValue({count:1}); runtime.db.automationRule.create.mockResolvedValue({ id: "r1", vendorId: "v1" }); runtime.db.automationRule.findFirst.mockResolvedValue({ id: "r1", isActive: true }); runtime.db.automationRule.update.mockResolvedValue({ id: "r1", isActive: false }); });
describe("automation actions", () => { it("requires CSRF and writes tenant-scoped rules", async () => { await expect(createAutomationRuleAction(form())).rejects.toThrow("redirect:/settings/automations?updated=created"); expect(runtime.security).toHaveBeenCalled(); expect(runtime.db.automationRule.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ vendorId: "v1", trigger: "payment_paid" }) })); expect(runtime.audit).toHaveBeenCalled(); }); it("toggles only a rule in the current vendor", async () => { const f = new FormData(); f.set("ruleId", "r1"); await expect(toggleAutomationRuleAction(f)).rejects.toThrow("redirect:/settings/automations?updated=toggled"); expect(runtime.db.automationRule.findFirst).toHaveBeenCalledWith({ where: { id: "r1", vendorId: "v1" }, select: { id: true, isActive: true, trigger: true, condition: true, actions: true, funnelPageId: true, version: true, updatedAt: true } }); });

  it("converts fixed voucher dollars to cents and rejects a free-order percentage", async () => {
    runtime.db.product.findFirst.mockResolvedValue({ id: "p1" });
    const fixed = form();
    fixed.delete("actionLine");
    fixed.set("actionVoucher", "on");
    fixed.set("productId", "p1");
    fixed.set("discountType", "fixed");
    fixed.set("discountValue", "100");
    fixed.set("expiresInDays", "30");
    await expect(createAutomationRuleAction(fixed)).rejects.toThrow("redirect:/settings/automations?updated=created");
    expect(runtime.db.automationRule.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ actions: [expect.objectContaining({ discountValue: 10_000 })] }),
    }));

    const freeOrder = new FormData();
    for (const [key, value] of fixed.entries()) freeOrder.set(key, value);
    freeOrder.set("discountType", "percentage");
    await expect(createAutomationRuleAction(freeOrder)).rejects.toThrow("redirect:/settings/automations?error=invalid_rule");
  });

  it("creates a tenant-scoped built-in recipe and dry-runs only an owned rule", async () => {
    runtime.db.product.findFirst.mockResolvedValue({ id: "p1" });
    const recipe = new FormData();
    recipe.set("recipeId", "vip_auto_tiering");
    recipe.set("productId", "p1");
    await expect(createAutomationRecipeAction(recipe)).rejects.toThrow("redirect:/settings/automations?updated=recipe_created");
    expect(runtime.db.automationRule.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ vendorId: "v1", trigger: "payment_paid", name: "高客單 VIP 自動尊榮升級" }),
    }));

    runtime.db.automationRule.findFirst.mockResolvedValue({ id: "r1", trigger: "payment_paid", condition: { type: "order_amount_gte", amountCents: 30_000 }, actions: [{ type: "add_customer_tag", tag: "VIP" }] });
    const dryRun = new FormData();
    dryRun.set("ruleId", "r1");
    dryRun.set("orderAmount", "300");
    await expect(dryRunAutomationRuleAction(dryRun)).rejects.toThrow("dryRun=would_dispatch");
    expect(runtime.db.automationRule.findFirst).toHaveBeenLastCalledWith(expect.objectContaining({ where: { id: "r1", vendorId: "v1" } }));
  });
});

describe('WP18 draft creation and activation',()=>{
 it.each(['followup_no_show','followup_completed_no_order','followup_checkout_incomplete'])('creates %s inactive under the authenticated vendor',async id=>{
  const data=new FormData();data.set('recipeId',id);
  await expect(createAutomationRecipeAction(data)).rejects.toThrow('updated=recipe_created');
  expect(runtime.security).toHaveBeenCalledWith(data);expect(runtime.owner).toHaveBeenCalled();
  expect(runtime.db.automationRule.create).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({vendorId:'v1',isActive:false})}));
  expect(runtime.audit).toHaveBeenCalledWith(expect.objectContaining({vendorId:'v1',action:'create_automation_recipe'}));
 });
 it.each(['viewer_completed','checkout_incomplete'])('rejects activation when %s is missing its exact producer contract',async trigger=>{
  runtime.db.automationRule.findFirst.mockResolvedValue({id:'r1',isActive:false,trigger});const data=new FormData();data.set('ruleId','r1');
  await expect(toggleAutomationRuleAction(data)).rejects.toThrow('error=trigger_not_ready');expect(runtime.db.automationRule.update).not.toHaveBeenCalled();
 });
 it('still allows deactivating an unfinished trigger if an old rule is already active',async()=>{
  runtime.db.automationRule.findFirst.mockResolvedValue({id:'r1',isActive:true,trigger:'checkout_incomplete',version:1,updatedAt:new Date('2026-01-01')});const data=new FormData();data.set('ruleId','r1');
  await expect(toggleAutomationRuleAction(data)).rejects.toThrow('updated=toggled');
  expect(runtime.db.automationRule.updateMany).toHaveBeenCalledWith({where:{vendorId:'v1',id:'r1',isActive:true,version:1,updatedAt:new Date('2026-01-01')},data:{isActive:false}});
 });
 it('does not let a crafted custom rule start an unfinished trigger active',async()=>{
  const data=form();data.set('trigger','checkout_incomplete');
  await expect(createAutomationRuleAction(data)).rejects.toThrow('error=invalid_rule');
  expect(runtime.db.automationRule.create).not.toHaveBeenCalled();
 });
 it('requires CSRF before creating draft rules',async()=>{
  runtime.security.mockRejectedValueOnce(new Error('csrf denied'));const data=new FormData();data.set('recipeId','followup_no_show');
  await expect(createAutomationRecipeAction(data)).rejects.toThrow('csrf denied');expect(runtime.db.automationRule.create).not.toHaveBeenCalled();
 });
});

it.each(['checkout_followup','completed_followup'])('rejects crafted custom email %s and cannot activate an injected stored rule',async template=>{
 const data=form();data.set('actionEmail','on');data.set('emailTemplate',template);
 await expect(createAutomationRuleAction(data)).rejects.toThrow('error=invalid_rule');expect(runtime.db.automationRule.create).not.toHaveBeenCalled();
 runtime.db.automationRule.findFirst.mockResolvedValue({id:'r1',isActive:false,trigger:'payment_paid',condition:{type:'always'},actions:[{type:'send_email_notification',template}]});
 const toggle=new FormData();toggle.set('ruleId','r1');await expect(toggleAutomationRuleAction(toggle)).rejects.toThrow('error=trigger_not_ready');expect(runtime.db.automationRule.update).not.toHaveBeenCalled();
});

it('still activates a supported existing draft rule after inspecting its actual condition and actions',async()=>{
 runtime.db.automationRule.findFirst.mockResolvedValue({id:'r1',isActive:false,trigger:'form_no_show',condition:{type:'always'},actions:[{type:'send_email_notification',template:'webinar_replay'}]});
 const data=new FormData();data.set('ruleId','r1');await expect(toggleAutomationRuleAction(data)).rejects.toThrow('updated=toggled');
 expect(runtime.db.automationRule.update).toHaveBeenCalledWith({where:{vendorId_id:{vendorId:'v1',id:'r1'}},data:{isActive:true}});
});

describe('WP18 guarded recipe activation',()=>{
 const recipes=[{trigger:'viewer_completed',condition:{type:'completed_and_not_ordered'},actions:[{type:'send_email_notification',template:'completed_followup'}]},{trigger:'checkout_incomplete',condition:{type:'order_pending_payment'},actions:[{type:'send_email_notification',template:'checkout_followup'}]}];
 const stored=(recipe:typeof recipes[number])=>({id:'r1',isActive:false,funnelPageId:null,version:1,updatedAt:new Date('2026-01-01'),...recipe});
 const toggle=()=>{const f=new FormData();f.set('ruleId','r1');return f};
 it.each(recipes)('activates only the inspected owned $trigger snapshot and advances its version',async recipe=>{
  runtime.db.automationRule.findFirst.mockResolvedValue(stored(recipe));
  await expect(toggleAutomationRuleAction(toggle())).rejects.toThrow('updated=toggled');
  expect(runtime.db.automationRule.updateMany).toHaveBeenCalledWith({where:{vendorId:'v1',id:'r1',isActive:false,version:1,updatedAt:new Date('2026-01-01')},data:{isActive:true,version:{increment:1}}});
  expect(runtime.db.automationRule.update).not.toHaveBeenCalled();expect(runtime.audit).toHaveBeenCalledWith(expect.objectContaining({vendorId:'v1',action:'activate_automation_rule',after:{id:'r1',isActive:true,version:2}}));
 });
 it('rejects a stored funnel-scoped variant the producer cannot consume',async()=>{
  runtime.db.automationRule.findFirst.mockResolvedValue({...stored(recipes[0]),funnelPageId:'funnel-1'});
  await expect(toggleAutomationRuleAction(toggle())).rejects.toThrow('error=trigger_not_ready');expect(runtime.db.automationRule.updateMany).not.toHaveBeenCalled();
 });
 it('does not activate a rule edited or toggled after the inspected snapshot',async()=>{
  runtime.db.automationRule.findFirst.mockResolvedValue(stored(recipes[0]));runtime.db.automationRule.updateMany.mockResolvedValueOnce({count:0});
  await expect(toggleAutomationRuleAction(toggle())).rejects.toThrow('error=rule_changed');expect(runtime.audit).not.toHaveBeenCalled();
 });
 it('does not read or mutate rules after owner authorization fails',async()=>{
  runtime.owner.mockRejectedValueOnce(new Error('owner required'));
  await expect(toggleAutomationRuleAction(toggle())).rejects.toThrow('owner required');expect(runtime.db.automationRule.findFirst).not.toHaveBeenCalled();expect(runtime.db.automationRule.updateMany).not.toHaveBeenCalled();
 });
 it('does not touch an absent or other-vendor rule',async()=>{
  runtime.db.automationRule.findFirst.mockResolvedValue(null);
  await expect(toggleAutomationRuleAction(toggle())).rejects.toThrow('error=not_found');expect(runtime.db.automationRule.updateMany).not.toHaveBeenCalled();
 });
 it('does not pretend user dryrun values prove completed-source eligibility',async()=>{
  runtime.db.automationRule.findFirst.mockResolvedValue(stored(recipes[0]));const f=toggle();f.set('watchSeconds','99999');f.set('hasOrdered','false');
  await expect(dryRunAutomationRuleAction(f)).rejects.toThrow('dryRun=trusted_source_required');expect(runtime.db.automationRule.updateMany).not.toHaveBeenCalled();
 });
});

it('rejects voucher recipe creation without an explicit product instead of querying an undefined id',async()=>{
 const f=new FormData();f.set('recipeId','vip_auto_tiering');await expect(createAutomationRecipeAction(f)).rejects.toThrow('error=recipe_requires_product');expect(runtime.db.product.findFirst).not.toHaveBeenCalled();expect(runtime.db.automationRule.create).not.toHaveBeenCalled();
});
