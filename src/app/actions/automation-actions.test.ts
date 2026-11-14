import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
const runtime = vi.hoisted(() => ({ db: { product: { findFirst: vi.fn() }, automationRule: { create: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn(), delete: vi.fn() }, automationExecutionLog: { count: vi.fn() }, delayedStepRun: { count: vi.fn(), updateMany: vi.fn() }, $queryRaw: vi.fn(), $executeRaw: vi.fn(), $transaction: vi.fn() }, auth: { vendor: { id: "v1" }, user: { id: "u1" }, member: { role: "admin" } }, security: vi.fn(), manager: vi.fn(), audit: vi.fn(), revalidate: vi.fn(), redirect: vi.fn((path: string): never => { throw new Error(`redirect:${path}`); }) }));
vi.mock("next/cache", () => ({ revalidatePath: runtime.revalidate })); vi.mock("next/navigation", () => ({ redirect: runtime.redirect })); vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: runtime.security })); vi.mock("@/lib/auth", () => ({ requireVendorManagerMember: runtime.manager })); vi.mock("@/lib/db", () => ({ getDb: () => runtime.db })); vi.mock("@/lib/audit", () => ({ auditSnapshot: (v: unknown) => v, writeAuditLog: runtime.audit }));
import { createAutomationRecipeAction, createAutomationRuleAction, deleteAutomationRuleAction, dryRunAutomationRuleAction, toggleAutomationRuleAction } from "./automation-actions";
// The default actor is an admin, so the default rule tags the customer; a
// LINE push is owner-only (owner decision 2026-11-14) and uses lineForm + owner.
function form(trigger = "form_registered") { const f = new FormData(); f.set("name", "報名追蹤"); f.set("trigger", trigger); f.set("actionTag", "on"); f.set("customerTag", "已報名"); return f; }
function lineForm(trigger = "form_registered") { const f = form(trigger); f.delete("actionTag"); f.set("actionLine", "on"); f.set("lineMessage", "謝謝報名"); return f; }
const asOwner = () => runtime.manager.mockResolvedValue({ ...runtime.auth, member: { role: "owner" } });
function ruleForm(id = "r1") { const f = new FormData(); f.set("ruleId", id); return f; }
const HIDDEN_TRIGGERS = ["form_no_show", "viewer_watch_progress", "webinar_attended_duration_gte"] as const;
beforeEach(() => { vi.clearAllMocks(); runtime.manager.mockResolvedValue(runtime.auth); runtime.db.automationRule.create.mockResolvedValue({ id: "r1", vendorId: "v1" }); runtime.db.automationRule.findFirst.mockResolvedValue({ id: "r1", isActive: true, trigger: "form_registered" }); runtime.db.automationRule.updateMany.mockResolvedValue({ count: 1 }); runtime.db.automationRule.delete.mockResolvedValue({ id: "r1" }); runtime.db.automationExecutionLog.count.mockResolvedValue(0); runtime.db.delayedStepRun.count.mockResolvedValue(0); runtime.db.delayedStepRun.updateMany.mockResolvedValue({ count: 0 }); runtime.db.$queryRaw.mockResolvedValue([{ id: "r1" }]); runtime.db.$transaction.mockImplementation(async (work: (tx: unknown) => unknown) => work(runtime.db)); });
describe("automation actions", () => { it("requires CSRF and writes tenant-scoped rules", async () => { await expect(createAutomationRuleAction(form())).rejects.toThrow("redirect:/settings/automations?updated=created"); expect(runtime.security).toHaveBeenCalled(); expect(runtime.manager).toHaveBeenCalledWith("/settings/automations"); expect(runtime.db.automationRule.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ vendorId: "v1", trigger: "form_registered", condition: { type: "always" } }) })); expect(runtime.audit).toHaveBeenCalledWith(expect.objectContaining({ vendorId: "v1", actorId: "u1", actorLabel: "admin" })); }); it("toggles only a rule in the current vendor", async () => { await expect(toggleAutomationRuleAction(ruleForm())).rejects.toThrow("redirect:/settings/automations?updated=toggled"); expect(runtime.db.automationRule.findFirst).toHaveBeenCalledWith({ where: { id: "r1", vendorId: "v1" }, select: { id: true, isActive: true, trigger: true } }); expect(runtime.db.automationRule.updateMany).toHaveBeenCalledWith({ where: { id: "r1", vendorId: "v1", isActive: true }, data: { isActive: false } });
    // F-4 review M1: the rule row is locked FOR UPDATE (bound to the vendor) and its active delayed-step runs stop in the same transaction.
    const [lockSql, ...lockValues] = runtime.db.$queryRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    expect(lockSql.join("?")).toMatch(/FROM "AutomationRule" WHERE "id" = \? AND "vendorId" = \? FOR UPDATE/u);
    expect(lockValues).toEqual(["r1", "v1"]);
    expect(runtime.db.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(runtime.db.automationRule.updateMany.mock.invocationCallOrder[0]!);
    expect(runtime.db.delayedStepRun.updateMany).toHaveBeenCalledWith({ where: { vendorId: "v1", automationRuleId: "r1", status: "active" }, data: { status: "cancelled", cancelReason: "definition_paused", nextRunAt: null, claimedAt: null } });
    // Switching on stops nothing.
    runtime.db.delayedStepRun.updateMany.mockClear();
    runtime.db.automationRule.findFirst.mockResolvedValueOnce({ id: "r1", isActive: false, trigger: "form_registered" });
    await expect(toggleAutomationRuleAction(ruleForm())).rejects.toThrow("redirect:/settings/automations?updated=toggled");
    expect(runtime.db.delayedStepRun.updateMany).not.toHaveBeenCalled(); });

  it("converts fixed voucher dollars to cents and rejects a free-order percentage", async () => {
    runtime.db.product.findFirst.mockResolvedValue({ id: "p1" });
    const fixed = form();
    fixed.delete("actionTag");
    fixed.set("actionVoucher", "on");
    fixed.set("productId", "p1");
    fixed.set("discountType", "fixed");
    fixed.set("discountValue", "100");
    fixed.set("expiresInDays", "30");
    await expect(createAutomationRuleAction(fixed)).rejects.toThrow("redirect:/settings/automations?updated=created");
    expect(runtime.db.automationRule.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ actions: [expect.objectContaining({ discountValue: 10_000 })] }),
    }));
    expect(runtime.db.product.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "p1", vendorId: "v1", isActive: true } }));

    const freeOrder = new FormData();
    for (const [key, value] of fixed.entries()) freeOrder.set(key, value);
    freeOrder.set("discountType", "percentage");
    await expect(createAutomationRuleAction(freeOrder)).rejects.toThrow("redirect:/settings/automations?error=invalid_rule");
  });

  it.each(["https://brand.example@evil.example/offer", "https://user:pass@evil.example", "https://:@evil.example", "https:///evil.example", "http://evil.example", "javascript:alert(1)", "/\\evil.example"])("rejects the LINE button URL %s with a dedicated error and writes nothing", async (buttonUrl) => {
    asOwner();
    const f = lineForm();
    f.set("buttonLabel", "立即查看");
    f.set("buttonUrl", buttonUrl);
    await expect(createAutomationRuleAction(f)).rejects.toThrow("redirect:/settings/automations?error=invalid_button_url");
    expect(runtime.db.automationRule.create).not.toHaveBeenCalled();
  });

  it.each(["https://shop.example/offer?x=1", "{{voucher_url}}", "{{webinar_url}}"])("accepts the LINE button URL %s", async (buttonUrl) => {
    asOwner();
    const f = lineForm();
    f.set("buttonLabel", "立即查看");
    f.set("buttonUrl", buttonUrl);
    await expect(createAutomationRuleAction(f)).rejects.toThrow("redirect:/settings/automations?updated=created");
    expect(runtime.db.automationRule.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ actions: [expect.objectContaining({ type: "line_push", buttonUrl })] }) }));
  });

  it.each(["form_registered", "consultation_booked", "consultation_no_show"])("creates a rule on the available trigger %s", async (trigger) => {
    await expect(createAutomationRuleAction(form(trigger))).rejects.toThrow("redirect:/settings/automations?updated=created");
    expect(runtime.db.automationRule.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ vendorId: "v1", trigger }) }));
  });

  // F-4 PR 3: payment_paid is wired to the payment webhook and back on the list, with a paid-amount threshold in NT$.
  it("creates a payment_paid rule with its threshold stored in cents", async () => {
    const f = form("payment_paid");
    f.set("conditionValue", "300");
    await expect(createAutomationRuleAction(f)).rejects.toThrow("redirect:/settings/automations?updated=created");
    expect(runtime.db.automationRule.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ vendorId: "v1", trigger: "payment_paid", condition: { type: "order_amount_gte", amountCents: 30_000 } }),
    }));
  });

  it.each(["", "0", "-5", "1.5"])("refuses a payment_paid rule without a whole, positive threshold (%j)", async (value) => {
    const f = form("payment_paid");
    f.set("conditionValue", value);
    await expect(createAutomationRuleAction(f)).rejects.toThrow("redirect:/settings/automations?error=invalid_rule");
    expect(runtime.db.automationRule.create).not.toHaveBeenCalled();
  });

  it.each(HIDDEN_TRIGGERS)("refuses to create a rule on the hidden trigger %s, even with a valid threshold", async (trigger) => {
    const f = form(trigger);
    f.set("conditionValue", "100");
    await expect(createAutomationRuleAction(f)).rejects.toThrow("redirect:/settings/automations?error=trigger_unavailable");
    expect(runtime.db.automationRule.create).not.toHaveBeenCalled();
    expect(runtime.audit).not.toHaveBeenCalled();
  });

  it("refuses an unknown trigger as an invalid rule", async () => {
    await expect(createAutomationRuleAction(form("made_up"))).rejects.toThrow("redirect:/settings/automations?error=invalid_rule");
    expect(runtime.db.automationRule.create).not.toHaveBeenCalled();
  });

  it("creates the available built-in recipes and refuses the ones on hidden triggers", async () => {
    // 「諮詢預約提醒與防爽約」 sends a LINE push, so the owner applies it.
    asOwner();
    const recipe = new FormData();
    recipe.set("recipeId", "consultation_confirmer");
    await expect(createAutomationRecipeAction(recipe)).rejects.toThrow("redirect:/settings/automations?updated=recipe_created");
    expect(runtime.db.automationRule.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ vendorId: "v1", trigger: "consultation_booked", name: "諮詢預約提醒與防爽約" }),
    }));

    runtime.db.automationRule.create.mockClear();
    runtime.db.product.findFirst.mockResolvedValue({ id: "p1" });
    const vip = new FormData();
    vip.set("recipeId", "vip_auto_tiering");
    vip.set("productId", "p1");
    await expect(createAutomationRecipeAction(vip)).rejects.toThrow("redirect:/settings/automations?updated=recipe_created");
    expect(runtime.db.product.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "p1", vendorId: "v1", isActive: true } }));
    expect(runtime.db.automationRule.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ vendorId: "v1", trigger: "payment_paid", condition: { type: "order_amount_gte", amountCents: 3_000_000 } }),
    }));

    runtime.db.automationRule.create.mockClear();
    for (const recipeId of ["high_intent_chaser", "no_show_reactivation"]) {
      const hidden = new FormData();
      hidden.set("recipeId", recipeId);
      hidden.set("productId", "p1");
      await expect(createAutomationRecipeAction(hidden)).rejects.toThrow("redirect:/settings/automations?error=trigger_unavailable");
    }
    expect(runtime.db.automationRule.create).not.toHaveBeenCalled();
  });

  it("dry-runs only an owned rule and reports a hidden trigger as not running", async () => {
    runtime.db.automationRule.findFirst.mockResolvedValue({ id: "r1", trigger: "consultation_booked", condition: { type: "always" }, actions: [{ type: "add_customer_tag", tag: "VIP" }] });
    await expect(dryRunAutomationRuleAction(ruleForm())).rejects.toThrow("dryRun=would_dispatch");
    expect(runtime.db.automationRule.findFirst).toHaveBeenLastCalledWith(expect.objectContaining({ where: { id: "r1", vendorId: "v1" } }));

    // payment_paid is available again: the simulated amount decides.
    runtime.db.automationRule.findFirst.mockResolvedValue({ id: "r1", trigger: "payment_paid", condition: { type: "order_amount_gte", amountCents: 30_000 }, actions: [{ type: "add_customer_tag", tag: "VIP" }] });
    const paid = ruleForm();
    paid.set("orderAmount", "300");
    await expect(dryRunAutomationRuleAction(paid)).rejects.toThrow("redirect:/settings/automations?dryRun=would_dispatch");
    paid.set("orderAmount", "299");
    await expect(dryRunAutomationRuleAction(paid)).rejects.toThrow("redirect:/settings/automations?dryRun=would_skip");

    runtime.db.automationRule.findFirst.mockResolvedValue({ id: "r1", trigger: "form_no_show", condition: { type: "always" }, actions: [{ type: "add_customer_tag", tag: "VIP" }] });
    await expect(dryRunAutomationRuleAction(ruleForm())).rejects.toThrow("redirect:/settings/automations?dryRun=trigger_unavailable");

    runtime.db.automationRule.findFirst.mockResolvedValue(null);
    await expect(dryRunAutomationRuleAction(ruleForm("foreign"))).rejects.toThrow("redirect:/settings/automations?error=not_found");
  });

  // Review MAJOR-1: the migration switches existing payment_paid rules off; the merchant switches them on again here.
  it("switches a paused payment_paid rule on again like any switched-off rule", async () => {
    runtime.db.automationRule.findFirst.mockResolvedValueOnce({ id: "r1", isActive: false, trigger: "payment_paid" });
    await expect(toggleAutomationRuleAction(ruleForm())).rejects.toThrow("redirect:/settings/automations?updated=toggled");
    expect(runtime.db.automationRule.updateMany).toHaveBeenCalledWith({ where: { id: "r1", vendorId: "v1", isActive: false }, data: { isActive: true } });
    expect(runtime.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "activate_automation_rule", targetId: "r1" }));
  });

  it.each(HIDDEN_TRIGGERS)("lets an existing %s rule be switched off but never on again", async (trigger) => {
    runtime.db.automationRule.findFirst.mockResolvedValueOnce({ id: "r1", isActive: true, trigger });
    await expect(toggleAutomationRuleAction(ruleForm())).rejects.toThrow("redirect:/settings/automations?updated=toggled");
    expect(runtime.db.automationRule.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { isActive: false } }));

    runtime.db.automationRule.updateMany.mockClear();
    runtime.db.automationRule.findFirst.mockResolvedValueOnce({ id: "r1", isActive: false, trigger });
    await expect(toggleAutomationRuleAction(ruleForm())).rejects.toThrow("redirect:/settings/automations?error=trigger_unavailable");
    expect(runtime.db.automationRule.updateMany).not.toHaveBeenCalled();
  });

  it("reports a rule switched by someone else between the read and the update as a conflict", async () => {
    runtime.db.automationRule.updateMany.mockResolvedValueOnce({ count: 0 });
    runtime.db.automationRule.findFirst.mockResolvedValueOnce({ id: "r1", isActive: true, trigger: "form_registered" }).mockResolvedValueOnce({ id: "r1" });
    await expect(toggleAutomationRuleAction(ruleForm())).rejects.toThrow("redirect:/settings/automations?error=toggle_conflict");
    expect(runtime.db.automationRule.findFirst).toHaveBeenLastCalledWith({ where: { id: "r1", vendorId: "v1" }, select: { id: true } });
    expect(runtime.audit).not.toHaveBeenCalled();
  });

  it("reports a rule deleted between the read and the update as not found", async () => {
    runtime.db.automationRule.updateMany.mockResolvedValueOnce({ count: 0 });
    runtime.db.automationRule.findFirst.mockResolvedValueOnce({ id: "r1", isActive: true, trigger: "form_registered" }).mockResolvedValueOnce(null);
    await expect(toggleAutomationRuleAction(ruleForm())).rejects.toThrow("redirect:/settings/automations?error=not_found");
    expect(runtime.audit).not.toHaveBeenCalled();
  });

  it("locks the rule, re-checks it and deletes a switched-off rule without history, bound to the current vendor", async () => {
    runtime.db.automationRule.findFirst.mockResolvedValue({ id: "r1", name: "舊規則", trigger: "form_no_show", isActive: false, funnelPageId: null });
    await expect(deleteAutomationRuleAction(ruleForm())).rejects.toThrow("redirect:/settings/automations?updated=deleted");
    expect(runtime.db.$transaction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ timeout: expect.any(Number) }));
    // The lock wait is bounded before the rule row is locked.
    const [setLocal] = runtime.db.$executeRaw.mock.calls[0] as [TemplateStringsArray];
    expect(setLocal.join("?")).toBe("SET LOCAL lock_timeout = '5s'");
    expect(runtime.db.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(runtime.db.$queryRaw.mock.invocationCallOrder[0]!);
    const [sql, ...values] = runtime.db.$queryRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    expect(sql.join("?")).toMatch(/FROM "AutomationRule" WHERE "id" = \? AND "vendorId" = \? FOR UPDATE/u);
    expect(values).toEqual(["r1", "v1"]);
    // The checks run after the lock, as separate statements.
    expect(runtime.db.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(runtime.db.automationRule.findFirst.mock.invocationCallOrder[0]!);
    expect(runtime.db.automationRule.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "r1", vendorId: "v1" } }));
    expect(runtime.db.automationExecutionLog.count).toHaveBeenCalledWith({ where: { vendorId: "v1", ruleId: "r1" } });
    expect(runtime.db.automationRule.delete).toHaveBeenCalledWith({ where: { vendorId_id: { vendorId: "v1", id: "r1" } } });
    expect(runtime.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "delete_automation_rule", targetId: "r1", before: expect.objectContaining({ trigger: "form_no_show" }) }));
  });

  it.each([
    ["an active rule", { isActive: true }, 0, "delete_requires_inactive"],
    ["a rule with history", { isActive: false }, 2, "delete_has_history"],
  ] as const)("keeps %s", async (_label, state, history, code) => {
    runtime.db.automationRule.findFirst.mockResolvedValue({ id: "r1", name: "規則", trigger: "form_registered", funnelPageId: null, ...state });
    runtime.db.automationExecutionLog.count.mockResolvedValue(history);
    await expect(deleteAutomationRuleAction(ruleForm())).rejects.toThrow(`redirect:/settings/automations?error=${code}`);
    expect(runtime.db.automationRule.delete).not.toHaveBeenCalled();
    expect(runtime.audit).not.toHaveBeenCalled();
  });

  it.each([
    ["a lock timeout (55P03)", () => new Prisma.PrismaClientKnownRequestError("canceling statement due to lock timeout", { code: "P2010", clientVersion: Prisma.prismaVersion.client, meta: { code: "55P03" } })],
    ["a transaction timeout (P2028)", () => new Prisma.PrismaClientKnownRequestError("Transaction API error", { code: "P2028", clientVersion: Prisma.prismaVersion.client })],
  ])("answers delete_busy after %s and changes nothing", async (_label, error) => {
    runtime.db.$transaction.mockRejectedValueOnce(error());
    await expect(deleteAutomationRuleAction(ruleForm())).rejects.toThrow("redirect:/settings/automations?error=delete_busy");
    expect(runtime.audit).not.toHaveBeenCalled();
  });

  it("keeps a rule with delayed-step runs (F-4), counted for the current vendor after the lock", async () => {
    runtime.db.automationRule.findFirst.mockResolvedValue({ id: "r1", name: "規則", trigger: "form_registered", funnelPageId: null, isActive: false });
    runtime.db.delayedStepRun.count.mockResolvedValue(1);
    await expect(deleteAutomationRuleAction(ruleForm())).rejects.toThrow("redirect:/settings/automations?error=delete_has_history");
    expect(runtime.db.delayedStepRun.count).toHaveBeenCalledWith({ where: { vendorId: "v1", automationRuleId: "r1" } });
    expect(runtime.db.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(runtime.db.delayedStepRun.count.mock.invocationCallOrder[0]!);
    expect(runtime.db.automationRule.delete).not.toHaveBeenCalled();
    expect(runtime.audit).not.toHaveBeenCalled();
  });

  it("still surfaces any other delete failure", async () => {
    runtime.db.$transaction.mockRejectedValueOnce(new Error("connection lost"));
    await expect(deleteAutomationRuleAction(ruleForm())).rejects.toThrow("connection lost");
  });

  it("reports another vendor's (or an already deleted) rule as not found", async () => {
    runtime.db.$queryRaw.mockResolvedValue([]);
    await expect(deleteAutomationRuleAction(ruleForm("foreign"))).rejects.toThrow("redirect:/settings/automations?error=not_found");
    expect(runtime.db.automationRule.delete).not.toHaveBeenCalled();
    expect(runtime.audit).not.toHaveBeenCalled();
  });

  describe("owner-only LINE push (owner decision 2026-11-14)", () => {
    it.each([
      ["a LINE push alone", () => lineForm()],
      ["a LINE push next to a tag", () => { const f = lineForm(); f.set("actionTag", "on"); f.set("customerTag", "已報名"); return f; }],
      ["a LINE push on payment_paid", () => { const f = lineForm("payment_paid"); f.set("conditionValue", "300"); return f; }],
    ])("refuses an admin's rule with %s before any query or audit", async (_label, build) => {
      await expect(createAutomationRuleAction(build())).rejects.toThrow("redirect:/settings/automations?error=line_push_owner_only");
      expect(runtime.db.automationRule.create).not.toHaveBeenCalled();
      expect(runtime.db.product.findFirst).not.toHaveBeenCalled();
      expect(runtime.audit).not.toHaveBeenCalled();
    });

    it("still runs the existing input checks first (an unsafe button URL stays invalid_button_url)", async () => {
      const f = lineForm();
      f.set("buttonLabel", "看");
      f.set("buttonUrl", "http://evil.example");
      await expect(createAutomationRuleAction(f)).rejects.toThrow("redirect:/settings/automations?error=invalid_button_url");
    });

    it("judges the server-parsed actions, not a form flag: an unchecked LINE box with text in the fields is no LINE push", async () => {
      const f = form();
      f.set("lineMessage", "沒有勾選");
      await expect(createAutomationRuleAction(f)).rejects.toThrow("redirect:/settings/automations?updated=created");
      expect(runtime.db.automationRule.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ actions: [{ type: "add_customer_tag", tag: "已報名" }] }) }));
    });

    it("lets the owner create a rule with a LINE push", async () => {
      asOwner();
      await expect(createAutomationRuleAction(lineForm())).rejects.toThrow("redirect:/settings/automations?updated=created");
      expect(runtime.db.automationRule.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ vendorId: "v1", actions: [expect.objectContaining({ type: "line_push", message: "謝謝報名" })] }) }));
      expect(runtime.audit).toHaveBeenCalledWith(expect.objectContaining({ actorLabel: "owner", action: "create_automation_rule" }));
    });

    it("refuses an admin the LINE push recipe and still lets them apply one without", async () => {
      const confirmer = new FormData();
      confirmer.set("recipeId", "consultation_confirmer");
      await expect(createAutomationRecipeAction(confirmer)).rejects.toThrow("redirect:/settings/automations?error=line_push_owner_only");
      expect(runtime.db.automationRule.create).not.toHaveBeenCalled();
      expect(runtime.audit).not.toHaveBeenCalled();

      runtime.db.product.findFirst.mockResolvedValue({ id: "p1" });
      const vip = new FormData();
      vip.set("recipeId", "vip_auto_tiering");
      vip.set("productId", "p1");
      await expect(createAutomationRecipeAction(vip)).rejects.toThrow("redirect:/settings/automations?updated=recipe_created");
      expect(runtime.db.automationRule.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ vendorId: "v1", trigger: "payment_paid" }) }));
    });

    it.each([
      ["its immediate actions", { actions: [{ type: "line_push", message: "嗨" }], steps: [] }],
      ["a switched-off delayed step", { actions: [{ type: "add_customer_tag", tag: "x" }], steps: [{ actions: [{ type: "add_customer_tag", tag: "y" }] }, { actions: [{ type: "line_push", message: "第二天" }] }] }],
    ])("keeps a rule with a LINE push in %s switched off for an admin, read after the vendor-bound lock", async (_label, stored) => {
      runtime.db.automationRule.findFirst
        .mockResolvedValueOnce({ id: "r1", isActive: false, trigger: "form_registered" })
        .mockResolvedValueOnce({ id: "r1", ...stored });
      await expect(toggleAutomationRuleAction(ruleForm())).rejects.toThrow("redirect:/settings/automations?error=line_push_owner_only");
      expect(runtime.db.automationRule.findFirst).toHaveBeenLastCalledWith({
        where: { id: "r1", vendorId: "v1" },
        select: { actions: true, steps: { where: { vendorId: "v1" }, select: { actions: true } } },
      });
      expect(runtime.db.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(runtime.db.automationRule.findFirst.mock.invocationCallOrder[1]!);
      expect(runtime.db.automationRule.updateMany).not.toHaveBeenCalled();
      expect(runtime.audit).not.toHaveBeenCalled();
    });

    it("lets an admin switch a rule with a LINE push off, without reading its actions", async () => {
      runtime.db.automationRule.findFirst.mockResolvedValueOnce({ id: "r1", isActive: true, trigger: "form_registered" });
      await expect(toggleAutomationRuleAction(ruleForm())).rejects.toThrow("redirect:/settings/automations?updated=toggled");
      expect(runtime.db.automationRule.findFirst).toHaveBeenCalledTimes(1);
      expect(runtime.db.automationRule.updateMany).toHaveBeenCalledWith({ where: { id: "r1", vendorId: "v1", isActive: true }, data: { isActive: false } });
    });

    it("lets the owner switch a rule with a LINE push on", async () => {
      asOwner();
      runtime.db.automationRule.findFirst.mockResolvedValueOnce({ id: "r1", isActive: false, trigger: "form_registered" });
      await expect(toggleAutomationRuleAction(ruleForm())).rejects.toThrow("redirect:/settings/automations?updated=toggled");
      // The owner needs no LINE push check, so the rule's actions are not read.
      expect(runtime.db.automationRule.findFirst).toHaveBeenCalledTimes(1);
      expect(runtime.db.automationRule.updateMany).toHaveBeenCalledWith({ where: { id: "r1", vendorId: "v1", isActive: false }, data: { isActive: true } });
      expect(runtime.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "activate_automation_rule", actorLabel: "owner" }));
    });

    it("answers not_found when an admin switches on a rule that disappeared before the lock", async () => {
      runtime.db.automationRule.findFirst.mockResolvedValueOnce({ id: "r1", isActive: false, trigger: "form_registered" }).mockResolvedValueOnce(null);
      await expect(toggleAutomationRuleAction(ruleForm())).rejects.toThrow("redirect:/settings/automations?error=not_found");
      expect(runtime.db.automationRule.updateMany).not.toHaveBeenCalled();
    });
  });

  it.each([
    ["createAutomationRuleAction", () => createAutomationRuleAction(form())],
    ["createAutomationRecipeAction", () => { const f = new FormData(); f.set("recipeId", "consultation_confirmer"); return createAutomationRecipeAction(f); }],
    ["dryRunAutomationRuleAction", () => dryRunAutomationRuleAction(ruleForm())],
    ["toggleAutomationRuleAction", () => toggleAutomationRuleAction(ruleForm())],
    ["deleteAutomationRuleAction", () => deleteAutomationRuleAction(ruleForm())],
  ])("%s stops at the owner/admin guard before touching the database", async (_name, run) => {
    runtime.manager.mockRejectedValueOnce(new Error("redirect:/dashboard?error=insufficient_role"));
    await expect(run()).rejects.toThrow("redirect:/dashboard?error=insufficient_role");
    expect(runtime.security).toHaveBeenCalled();
    for (const method of [...Object.values(runtime.db.automationRule), runtime.db.$transaction, runtime.db.$queryRaw, runtime.db.$executeRaw]) expect(method).not.toHaveBeenCalled();
    expect(runtime.db.product.findFirst).not.toHaveBeenCalled();
  });
});
