import { renderToStaticMarkup } from "react-dom/server"; import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ manager: vi.fn(), products: vi.fn(), rules: vi.fn(), logs: vi.fn(), runCounts: vi.fn() })); vi.mock("@/lib/auth", () => ({ requireVendorManagerMember: mocks.manager })); vi.mock("@/lib/db", () => ({ getDb: () => ({ product: { findMany: mocks.products }, automationRule: { findMany: mocks.rules }, automationExecutionLog: { findMany: mocks.logs }, delayedStepRun: { groupBy: mocks.runCounts } }) })); vi.mock("@/app/actions/automation-actions", () => ({ createAutomationRuleAction: vi.fn(), createAutomationRecipeAction: vi.fn(), deleteAutomationRuleAction: vi.fn(), dryRunAutomationRuleAction: vi.fn(), toggleAutomationRuleAction: vi.fn(), createAutomationRuleStepAction: vi.fn(), updateAutomationRuleStepAction: vi.fn(), deleteAutomationRuleStepAction: vi.fn() })); vi.mock("@/components/csrf-field", () => ({ CsrfField: () => <input type="hidden" name="csrf" /> }));
import Page from "./page";
const rule = (overrides: Record<string, unknown>) => ({ id: "r1", name: "報名回購", trigger: "form_registered", condition: { type: "always" }, actions: [{ type: "line_push" }], isActive: true, createdAt: new Date("2026-01-01"), _count: { executionLogs: 0 }, steps: [], ...overrides });
beforeEach(() => { vi.clearAllMocks(); mocks.manager.mockResolvedValue({ vendor: { id: "v1" }, user: { id: "u1" }, member: { role: "owner" } }); mocks.products.mockResolvedValue([{ id: "p1", name: "課程" }]); mocks.runCounts.mockResolvedValue([]); mocks.rules.mockResolvedValue([rule({})]); mocks.logs.mockResolvedValue([{ id: "l1", eventId: "form-registered:s1", rule: { name: "報名回購" }, trigger: "form_registered", subjectKeyHash: "abcdefgh12345678", status: "failed", errorCode: "action_failed", actionResults: null, createdAt: new Date("2026-01-02") }]); });
const render = async (searchParams: Record<string, string> = {}) => renderToStaticMarkup(await Page({ searchParams: Promise.resolve(searchParams) }));
describe("AutomationSettingsPage", () => {
  // The default actor is the owner, whose page is unchanged by the 2026-11-14
  // owner-only LINE push decision; the admin's view is covered further down.
  it("renders recipes, visual rules, dry-run and masked logs for an owner", async () => {
    const html = await render();
    expect(mocks.manager).toHaveBeenCalledWith("/settings/automations");
    expect(mocks.rules).toHaveBeenCalledWith(expect.objectContaining({ where: { vendorId: "v1" } }));
    expect(html).toMatch(/<h1[^>]*>自動化<\/h1>/);
    expect(html).toContain("商家 owner 與管理員可以管理");
    expect(html).toContain("諮詢預約提醒與防爽約");
    expect(html).toContain("Dry-run 測試");
    expect(html).toContain("abcd…5678");
    expect(html).toContain("action_failed");
    expect(html).toContain("LINE 推播訊息");
    expect(html).toContain("自動化寄出的 Email 都附退訂連結");
  });

  it("offers only the triggers and recipes that can run", async () => {
    const html = await render();
    const triggerSelect = html.match(/<select[^>]*name="trigger"[^>]*>([\s\S]*?)<\/select>/u)?.[1] ?? "";
    expect([...triggerSelect.matchAll(/value="([^"]+)"/gu)].map((match) => match[1])).toEqual(["form_registered", "consultation_booked", "consultation_no_show", "payment_paid"]);
    // F-4 PR 3: payment_paid and its recipe are back; the watch and no-show ones stay hidden.
    expect(html).toContain("高客單 VIP 自動尊榮升級");
    for (const hiddenRecipe of ["高意向追單漏斗", "開播缺席喚醒再行銷"]) expect(html).not.toContain(hiddenRecipe);
    // payment_paid takes a paid-amount threshold.
    expect(html).toContain('name="conditionValue"');
    expect(html).toContain("付款金額門檻（元；只用於「訂單付款完成」，其他觸發條件留空）");
  });

  it("keeps listing a rule on a hidden trigger, explains it, and only offers switching off and deleting", async () => {
    mocks.rules.mockResolvedValue([
      rule({ id: "watch-on", name: "觀看追單", trigger: "viewer_watch_progress", condition: { type: "watch_seconds_gte", seconds: 600 }, isActive: true }),
      rule({ id: "noshow-off", name: "缺席喚醒", trigger: "form_no_show", isActive: false }),
    ]);
    const html = await render();
    expect(html).toContain("觀看追單");
    expect(html).toContain("觸發：觀看進度更新");
    expect(html).toContain("觸發：報名但未出席直播");
    expect(html.match(/此觸發條件目前不會執行/gu)).toHaveLength(2);
    expect(html.match(/目前不會執行<\/span>/gu)).toHaveLength(2);
    expect(html).toContain(">停用<");
    expect(html).not.toContain(">啟用<");
    expect(html).not.toContain("Dry-run 測試");
    expect(html.match(/刪除規則/gu)).toHaveLength(1);
    expect(html).toContain("停用後才能刪除。");
  });

  it("keeps a rule with history from being deleted and shows why an e-mail was skipped", async () => {
    mocks.rules.mockResolvedValue([rule({ isActive: false, _count: { executionLogs: 3 } })]);
    mocks.logs.mockResolvedValue([{ id: "l2", eventId: "delayed-step:run-1:s1", rule: { name: "報名回購" }, trigger: "consultation_booked", subjectKeyHash: "abcdefgh12345678", status: "completed", errorCode: null, actionResults: [{ type: "send_email_notification", status: "skipped", reason: "recipient_blacklisted", template: "consultation_confirmation" }], createdAt: new Date("2026-01-02") }]);
    const html = await render();
    expect(html).not.toContain("刪除規則");
    expect(html).toContain("已有執行紀錄，保留供查詢，只能停用、不能刪除。");
    expect(html).toContain("Email 未寄出：收件人在本商家黑名單中");
    // A delayed step's execution is marked as such in the log.
    expect(html).toContain("諮詢預約成功（延遲步驟）");
  });

  const granted = (role = "owner") => mocks.manager.mockResolvedValue({ vendor: { id: "v1", betaFeatureGrants: ["automation_delayed_steps"] }, user: { id: "u1" }, member: { role } });

  it("shows no delayed-step section without the automation_delayed_steps grant (closed beta)", async () => {
    mocks.rules.mockResolvedValue([rule({ steps: [{ id: "s1", delayMinutes: 120, isActive: true, actions: [{ type: "add_customer_tag", tag: "x" }] }] })]);
    const html = await render();
    expect(html).not.toContain("延遲步驟（");
    expect(html).not.toContain("新增延遲步驟");
    expect(html).not.toContain("建立後可在規則下方加上延遲步驟");
    expect(mocks.runCounts).not.toHaveBeenCalled();
  });

  it("lists a rule's delayed steps with edit and delete forms, the add form and the run counts, all bound to the vendor", async () => {
    granted();
    mocks.rules.mockResolvedValue([rule({ steps: [
      { id: "s1", delayMinutes: 120, isActive: true, actions: [{ type: "send_email_notification", template: "repurchase_followup" }, { type: "add_customer_tag", tag: "兩小時後" }] },
      { id: "s2", delayMinutes: 4_320, isActive: false, actions: [{ type: "issue_repurchase_voucher", productId: "p1", discountType: "fixed", discountValue: 15_000, expiresInDays: 7 }] },
    ] })]);
    mocks.runCounts.mockResolvedValue([{ automationRuleId: "r1", status: "active", _count: { _all: 2 } }, { automationRuleId: "r1", status: "completed", _count: { _all: 1 } }]);
    const html = await render();
    expect(mocks.rules).toHaveBeenCalledWith(expect.objectContaining({ include: expect.objectContaining({ steps: expect.objectContaining({ where: { vendorId: "v1" } }) }) }));
    expect(mocks.runCounts).toHaveBeenCalledWith(expect.objectContaining({ where: { vendorId: "v1", automationRuleId: { not: null } } }));
    expect(html).toContain("立即執行：LINE 推播");
    expect(html).toContain("延遲步驟（2／10）");
    expect(html).toContain("事件後 2 小時");
    expect(html).toContain("事件後第 3 天");
    expect(html).toContain("進行中 2 人・完成 1 人・停止 0 人");
    expect(html).toContain("編輯步驟：事件後 2 小時");
    expect(html).toContain("新增「報名回購」的延遲步驟");
    expect(html.match(/name="stepId" value="s1"/gu)).toHaveLength(2);
    // The stored fixed voucher value (cents) is shown in dollars; the unit is days for whole days.
    expect(html).toMatch(/name="discountValue"[^>]*value="150"/u);
    expect(html).toMatch(/<option value="days" selected="">天<\/option>/u);
    expect(html).not.toContain('value="minutes"');
  });

  it("only lets a rule on a hidden trigger delete its steps", async () => {
    granted();
    mocks.rules.mockResolvedValue([rule({ trigger: "form_no_show", isActive: false, steps: [{ id: "s1", delayMinutes: 60, isActive: true, actions: [{ type: "add_customer_tag", tag: "x" }] }] })]);
    const html = await render();
    expect(html).toContain("刪除步驟");
    expect(html).not.toContain("編輯步驟：");
    expect(html).not.toContain("新增延遲步驟");
  });

  it("lists a payment_paid rule as running, with its dry-run, and offers no delayed steps for it", async () => {
    granted();
    mocks.rules.mockResolvedValue([rule({ id: "paid-on", name: "付款回購", trigger: "payment_paid", condition: { type: "order_amount_gte", amountCents: 10_000 }, isActive: true })]);
    const html = await render();
    expect(html).toContain("觸發：訂單付款完成");
    expect(html).toContain("條件：訂單滿");
    expect(html).not.toContain("此觸發條件目前不會執行");
    expect(html).toContain("Dry-run 測試");
    expect(html).toContain("「訂單付款完成」的規則目前只有立即執行的動作，還不能加延遲步驟。");
    expect(html).not.toContain("新增延遲步驟");
    expect(html).not.toContain("延遲步驟（0／10）");
  });

  it("shows a payment_paid rule paused by the deploy migration like any switched-off rule, with its switch-on button", async () => {
    mocks.rules.mockResolvedValue([rule({ id: "paid-off", name: "付款回購", trigger: "payment_paid", condition: { type: "order_amount_gte", amountCents: 10_000 }, isActive: false })]);
    const html = await render();
    expect(html).toContain("已停用");
    expect(html).toContain(">啟用<");
    expect(html).not.toContain("此觸發條件目前不會執行");
    expect(html).not.toContain("目前不會執行</span>");
  });

  it.each([
    ["error", "steps_unsupported", "「訂單付款完成」的規則目前只能設定立即執行的動作，不能加延遲步驟。"],
    ["updated", "step_created", "延遲步驟已新增。"],
    ["error", "duplicate_delay", "同一條規則已經有這個延遲時間的步驟"],
    ["error", "step_limit", "每條規則最多 10 個延遲步驟"],
    ["error", "invalid_delay", "1 小時到 90 天"],
    ["error", "trigger_unavailable", "這個觸發條件目前不會執行，不能用來建立或啟用規則。"],
    ["error", "delete_has_history", "只能停用、不能刪除"],
    ["dryRun", "trigger_unavailable", "這條規則的觸發條件目前不會執行"],
    ["error", "toggle_conflict", "規則剛被其他人變更，請重新整理後再試。"],
    ["error", "delete_busy", "規則正在執行，請稍後再試。"],
    ["error", "line_push_owner_only", "LINE 推播僅限擁有者設定。含 LINE 推播的規則，管理員只能停用、刪除規則或刪除步驟。"],
  ])("explains %s=%s", async (key, value, message) => {
    expect(await render({ [key]: value })).toContain(message);
  });

  describe("owner-only LINE push (owner decision 2026-11-14)", () => {
    const TAG = [{ type: "add_customer_tag", tag: "x" }];
    const admin = () => mocks.manager.mockResolvedValue({ vendor: { id: "v1" }, user: { id: "u1" }, member: { role: "admin" } });
    const ruleArticle = (html: string, name: string) => html.match(new RegExp(`<article aria-label="${name}"[\\s\\S]*?</article>`, "u"))?.[0] ?? "";

    it("gives an admin no LINE push fields, explains why, and keeps a LINE push recipe out of reach", async () => {
      admin();
      mocks.rules.mockResolvedValue([]);
      const html = await render();
      expect(html).toContain("LINE 推播僅限擁有者設定");
      const createForm = html.match(/<form[^>]*aria-label="建立自訂規則"[\s\S]*?<\/form>/u)?.[0] ?? "";
      expect(createForm).toContain("LINE 推播僅限擁有者設定。");
      for (const field of ['name="actionLine"', 'name="lineMessage"', 'name="buttonLabel"', 'name="buttonUrl"']) expect(html).not.toContain(field);
      // The other actions stay.
      for (const field of ['name="actionEmail"', 'name="actionVoucher"', 'name="actionTag"']) expect(createForm).toContain(field);
      // 「諮詢預約提醒與防爽約」 sends a LINE push: no apply button for an admin. The VIP recipe has none and stays.
      const recipes = [...html.matchAll(/<form[^>]*>(?:(?!<\/form>)[\s\S])*?name="recipeId" value="([^"]+)"[\s\S]*?<\/form>/gu)].map((match) => [match[1], match[0]] as const);
      const confirmer = recipes.find(([id]) => id === "consultation_confirmer")?.[1] ?? "";
      const vip = recipes.find(([id]) => id === "vip_auto_tiering")?.[1] ?? "";
      expect(confirmer).toContain("這個劇本含 LINE 推播。LINE 推播僅限擁有者設定。");
      expect(confirmer).not.toContain("一鍵套用劇本");
      expect(vip).toContain("一鍵套用劇本");
    });

    it("keeps the owner's LINE push fields and recipe button", async () => {
      mocks.rules.mockResolvedValue([]);
      const html = await render();
      expect(html).toContain('name="actionLine"');
      expect(html).not.toContain("這個劇本含 LINE 推播");
      expect(html).not.toContain("LINE 推播僅限擁有者設定");
      expect(html.match(/一鍵套用劇本/gu)).toHaveLength(2);
    });

    it("lets an admin switch off and delete a rule with a LINE push, but not switch it on or touch its steps", async () => {
      admin();
      granted("admin");
      mocks.rules.mockResolvedValue([
        rule({ id: "line-on", name: "立即推播", actions: [{ type: "line_push", message: "嗨" }], isActive: true }),
        rule({ id: "line-off", name: "停用推播", actions: [{ type: "line_push", message: "嗨" }], isActive: false }),
        // The LINE push is only in a (switched-off) delayed step: the rule still counts.
        rule({ id: "step-line", name: "步驟推播", actions: TAG, isActive: false, steps: [
          { id: "s-line", delayMinutes: 120, isActive: false, actions: [{ type: "line_push", message: "第二天" }] },
          { id: "s-tag", delayMinutes: 240, isActive: true, actions: TAG },
        ] }),
        rule({ id: "plain", name: "一般規則", actions: TAG, isActive: false, steps: [{ id: "s-plain", delayMinutes: 60, isActive: true, actions: TAG }] }),
      ]);
      const html = await render();

      const on = ruleArticle(html, "立即推播");
      expect(on).toContain("僅限擁有者修改");
      expect(on).toContain("這條規則含 LINE 推播。LINE 推播僅限擁有者設定。");
      expect(on).toContain(">停用<");
      expect(on).toContain("Dry-run 測試");
      expect(on).not.toContain("新增延遲步驟");

      const off = ruleArticle(html, "停用推播");
      expect(off).not.toContain(">啟用<");
      expect(off).toContain("刪除規則");

      const steps = ruleArticle(html, "步驟推播");
      expect(steps).toContain("僅限擁有者修改");
      expect(steps).not.toContain(">啟用<");
      expect(steps).not.toContain("編輯步驟：");
      expect(steps).not.toContain("新增延遲步驟");
      expect(steps).not.toContain('name="actionLine"');
      // Each step keeps only its delete form (no edit form): one stepId field per step.
      expect(steps.match(/name="stepId" value="s-line"/gu)).toHaveLength(1);
      expect(steps.match(/name="stepId" value="s-tag"/gu)).toHaveLength(1);
      expect(steps.match(/>刪除步驟</gu)).toHaveLength(2);
      expect(steps).toContain("刪除規則");

      // A rule without any LINE push is managed by an admin as before.
      const plain = ruleArticle(html, "一般規則");
      expect(plain).not.toContain("僅限擁有者修改");
      expect(plain).toContain(">啟用<");
      expect(plain).toContain("編輯步驟：事件後 1 小時");
      expect(plain).toContain("新增延遲步驟");
      expect(plain).not.toContain('name="actionLine"');
      expect(plain).toContain("LINE 推播僅限擁有者設定。");
    });

    it("words the read-only note for where the LINE push is and which controls the page shows (NIT-3)", async () => {
      const note = (html: string) => html.match(/<p class="[^"]*">([^<]*LINE 推播僅限擁有者設定。[^<]*)<\/p>/u)?.[1] ?? "";
      // Steps shown, LINE push only in a step.
      granted("admin");
      mocks.rules.mockResolvedValue([rule({ name: "步驟推播", actions: TAG, isActive: false, steps: [{ id: "s1", delayMinutes: 60, isActive: true, actions: [{ type: "line_push", message: "x" }] }] })]);
      expect(note(ruleArticle(await render(), "步驟推播"))).toBe("這條規則的延遲步驟含 LINE 推播。LINE 推播僅限擁有者設定。你可以停用、刪除規則或刪除步驟，但不能啟用、新增或修改步驟。");

      // payment_paid takes no steps: nothing about steps.
      mocks.rules.mockResolvedValue([rule({ name: "付款推播", trigger: "payment_paid", condition: { type: "order_amount_gte", amountCents: 10_000 }, actions: [{ type: "line_push", message: "x" }], isActive: false })]);
      const paid = ruleArticle(await render(), "付款推播");
      expect(note(paid)).toBe("這條規則含 LINE 推播。LINE 推播僅限擁有者設定。你可以停用或刪除規則，但不能啟用。");
      expect(paid).not.toContain("刪除步驟");

      // Beta off: the step section is hidden, so say the LINE push sits in a delayed step that is not shown.
      admin();
      mocks.rules.mockResolvedValue([rule({ name: "隱藏步驟", actions: TAG, isActive: false, steps: [{ id: "s1", delayMinutes: 60, isActive: true, actions: [{ type: "line_push", message: "x" }] }] })]);
      const hidden = ruleArticle(await render(), "隱藏步驟");
      expect(note(hidden)).toBe("這條規則的延遲步驟含 LINE 推播（延遲步驟目前不在此頁顯示）。LINE 推播僅限擁有者設定。你可以停用或刪除規則，但不能啟用。");
      expect(hidden).not.toContain("刪除步驟");
      expect(hidden).not.toContain(">啟用<");
    });

    it("leaves every control of a LINE push rule to the owner", async () => {
      granted("owner");
      mocks.rules.mockResolvedValue([rule({ id: "step-line", name: "步驟推播", actions: TAG, isActive: false, steps: [{ id: "s-line", delayMinutes: 120, isActive: false, actions: [{ type: "line_push", message: "第二天" }] }] })]);
      const html = ruleArticle(await render(), "步驟推播");
      expect(html).not.toContain("僅限擁有者修改");
      expect(html).toContain(">啟用<");
      expect(html).toContain("編輯步驟：事件後 2 小時");
      expect(html).toContain("新增延遲步驟");
      expect(html).toMatch(/name="lineMessage"[^>]*>第二天<\/textarea>/u);
    });
  });
});
