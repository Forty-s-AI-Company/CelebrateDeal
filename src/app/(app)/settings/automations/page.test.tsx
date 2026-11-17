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
    // Q-11 review M-1: form_no_show and its recipe only with the closed-beta grant.
    expect([...triggerSelect.matchAll(/value="([^"]+)"/gu)].map((match) => match[1])).toEqual(["form_registered", "consultation_booked", "consultation_no_show", "payment_paid"]);
    // F-4 PR 3: payment_paid and its recipe are back. The watch one stays hidden.
    expect(html).toContain("高客單 VIP 自動尊榮升級");
    for (const hidden of ["高意向追單漏斗", "開播缺席喚醒再行銷", "報名後未出席直播"]) expect(html).not.toContain(hidden);
    // payment_paid takes a paid-amount threshold.
    expect(html).toContain('name="conditionValue"');
    expect(html).toContain("付款金額門檻（元；只用於「訂單付款完成」，其他觸發條件留空）");
  });

  it("keeps listing a rule on a hidden trigger, explains it, and only offers switching off and deleting", async () => {
    mocks.rules.mockResolvedValue([
      rule({ id: "watch-on", name: "觀看追單", trigger: "viewer_watch_progress", condition: { type: "watch_seconds_gte", seconds: 600 }, isActive: true }),
      rule({ id: "duration-off", name: "觀看達標", trigger: "webinar_attended_duration_gte", condition: { type: "watch_seconds_gte", seconds: 600 }, isActive: false }),
    ]);
    const html = await render();
    expect(html).toContain("觀看追單");
    expect(html).toContain("觸發：觀看進度更新");
    expect(html).toContain("觸發：觀看累積秒數達標");
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
    mocks.rules.mockResolvedValue([rule({ trigger: "viewer_watch_progress", condition: { type: "watch_seconds_gte", seconds: 60 }, isActive: false, steps: [{ id: "s1", delayMinutes: 60, isActive: true, actions: [{ type: "add_customer_tag", tag: "x" }] }] })]);
    const html = await render();
    expect(html).toContain("刪除步驟");
    expect(html).not.toContain("編輯步驟：");
    expect(html).not.toContain("新增延遲步驟");
  });

  const noShowGranted = (grants = ["automation_form_no_show"]) => mocks.manager.mockResolvedValue({ vendor: { id: "v1", betaFeatureGrants: grants }, user: { id: "u1" }, member: { role: "owner" } });

  it("offers form_no_show and its recipe with the closed-beta grant, each with the misdetection note (review M-1)", async () => {
    noShowGranted();
    mocks.rules.mockResolvedValue([]);
    const html = await render();
    const triggerSelect = html.match(/<select[^>]*name="trigger"[^>]*>([\s\S]*?)<\/select>/u)?.[1] ?? "";
    expect([...triggerSelect.matchAll(/value="([^"]+)"/gu)].map((match) => match[1])).toEqual(["form_registered", "form_no_show", "consultation_booked", "consultation_no_show", "payment_paid"]);
    expect(triggerSelect).toContain(">報名後未出席直播<");
    const recipe = [...html.matchAll(/<form[^>]*>(?:(?!<\/form>)[\s\S])*?name="recipeId" value="no_show_reactivation"[\s\S]*?<\/form>/gu)][0]?.[0] ?? "";
    expect(recipe).toContain("開播缺席喚醒再行銷");
    expect(recipe).toContain("報名後未出席直播 → Email 通知");
    expect(recipe).toContain("只能辨識在完成報名驗證的同一個瀏覽器觀看的人");
    expect(html).toContain("單一開播時間的直播只算開播前 14 天內完成驗證的報名者");
  });

  it("explains a form_no_show rule of a vendor without the grant and only offers switching off and deleting", async () => {
    mocks.rules.mockResolvedValue([rule({ id: "noshow-on", name: "缺席喚醒", trigger: "form_no_show", isActive: true, actions: [{ type: "add_customer_tag", tag: "缺席" }] })]);
    const html = await render();
    expect(html).toContain("「報名後未出席直播」目前是封測功能，尚未對你的商家開放，這條規則不會執行。");
    expect(html).toContain("只能辨識在完成報名驗證的同一個瀏覽器觀看的人");
    expect(html).toContain(">停用<");
    expect(html).not.toContain("Dry-run 測試");
  });

  it("lists a form_no_show rule as running, with its dry-run, its delayed steps and the misdetection note (Q-11)", async () => {
    noShowGranted(["automation_delayed_steps", "automation_form_no_show"]);
    mocks.rules.mockResolvedValue([rule({ id: "noshow-on", name: "缺席喚醒", trigger: "form_no_show", isActive: true, steps: [{ id: "s1", delayMinutes: 1_440, isActive: true, actions: [{ type: "add_customer_tag", tag: "缺席" }] }] })]);
    const html = await render();
    expect(html).toContain("觸發：報名後未出席直播");
    expect(html).not.toContain("此觸發條件目前不會執行");
    expect(html).toContain("Dry-run 測試");
    expect(html).toContain("編輯步驟：事件後第 1 天");
    expect(html).toContain("新增「缺席喚醒」的延遲步驟");
    expect(html).toContain("只能辨識在完成報名驗證的同一個瀏覽器觀看的人");
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
    ["error", "line_push_owner_only", "LINE 推播與派券的 LINE 通知僅限擁有者設定。會發 LINE 訊息的規則，管理員只能停用、刪除規則或刪除步驟。"],
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

    // Owner decision 2026-11-15: a voucher's fixed-text LINE notification is the owner's too.
    describe("voucher LINE notification (owner decision 2026-11-15)", () => {
      const VOUCHER = { type: "issue_repurchase_voucher", productId: "p1", discountType: "fixed", discountValue: 15_000, expiresInDays: 7 };
      const voucherNote = (html: string) => html.match(/<p class="[^"]*">([^<]*派券的 LINE 通知僅限擁有者設定。[^<]*)<\/p>/u)?.[1] ?? "";

      it("gives the owner the checkbox, ticked for a new voucher and showing a stored voucher's flag", async () => {
        granted("owner");
        mocks.rules.mockResolvedValue([rule({ id: "v", name: "派券", actions: TAG, isActive: false, steps: [
          { id: "s-on", delayMinutes: 60, isActive: true, actions: [VOUCHER] },
          { id: "s-off", delayMinutes: 120, isActive: true, actions: [{ ...VOUCHER, lineNotification: false }] },
        ] })]);
        const html = await render();
        const createForm = html.match(/<form[^>]*aria-label="建立自訂規則"[\s\S]*?<\/form>/u)?.[0] ?? "";
        expect(createForm).toContain('<input type="hidden" name="voucherLineNotificationShown" value="1"/>');
        expect(createForm).toMatch(/<input type="checkbox" name="voucherLineNotification" checked=""\/> 同時用 LINE 通知買家領券/u);
        expect(createForm).toContain("同一條規則或同一步已勾選 LINE 推播時，不會另外再發這則通知。");
        expect(createForm).not.toContain("派券的 LINE 通知僅限擁有者設定");
        const editForm = (label: string) => html.match(new RegExp(`<form[^>]*aria-label="編輯步驟：${label}"[\\s\\S]*?</form>`, "u"))?.[0] ?? "";
        // A voucher stored before the flag existed shows ticked (it still sends); one stored off shows unticked.
        expect(editForm("事件後 1 小時")).toMatch(/name="voucherLineNotification" checked=""/u);
        expect(editForm("事件後 2 小時")).toMatch(/name="voucherLineNotification"\/>/u);
        expect(html).toContain("派發回購券（不發 LINE 通知）");
        // The owner's rule is not read-only.
        expect(ruleArticle(html, "派券")).not.toContain("僅限擁有者修改");
      });

      it("gives an admin no checkbox and says how the buyer still gets the voucher, on the form and the voucher recipe", async () => {
        admin();
        mocks.rules.mockResolvedValue([]);
        const html = await render();
        expect(html).not.toContain('name="voucherLineNotification"');
        expect(html).not.toContain('name="voucherLineNotificationShown"');
        const createForm = html.match(/<form[^>]*aria-label="建立自訂規則"[\s\S]*?<\/form>/u)?.[0] ?? "";
        const explanation = "派券的 LINE 通知僅限擁有者設定。你設定的派券不會用 LINE 通知買家：買家可在學員專區的「專屬優惠券」看到這張券（限可在本平台結帳的商品）；要主動通知，請同時勾選 Email 通知並選「追購通知」範本，信中會附領券連結。";
        expect(createForm).toContain(explanation);
        const vip = html.match(/<form[^>]*>(?:(?!<\/form>)[\s\S])*?name="recipeId" value="vip_auto_tiering"[\s\S]*?<\/form>/u)?.[0] ?? "";
        expect(vip).toContain(explanation);
        expect(vip).toContain("一鍵套用劇本");
      });

      it("makes a rule whose voucher still sends LINE read-only for an admin, and leaves one saved without it to the admin", async () => {
        granted("admin");
        mocks.rules.mockResolvedValue([
          // Stored before the flag existed (an admin's old voucher rule): it still sends LINE.
          rule({ id: "legacy", name: "舊派券", actions: [VOUCHER], isActive: false }),
          rule({ id: "step-voucher", name: "步驟派券", actions: TAG, isActive: false, steps: [{ id: "s-v", delayMinutes: 60, isActive: true, actions: [{ ...VOUCHER, lineNotification: true }] }] }),
          rule({ id: "silent", name: "不通知派券", actions: [{ ...VOUCHER, lineNotification: false }], isActive: false, steps: [{ id: "s-silent", delayMinutes: 60, isActive: true, actions: [{ ...VOUCHER, lineNotification: false }] }] }),
        ]);
        const html = await render();

        const legacy = ruleArticle(html, "舊派券");
        expect(legacy).toContain("僅限擁有者修改");
        expect(voucherNote(legacy)).toBe("這條規則派券時會用 LINE 通知買家。派券的 LINE 通知僅限擁有者設定。你可以停用、刪除規則或刪除步驟，但不能啟用、新增或修改步驟。");
        expect(legacy).not.toContain(">啟用<");
        expect(legacy).not.toContain("新增延遲步驟");
        expect(legacy).toContain("刪除規則");

        const steps = ruleArticle(html, "步驟派券");
        expect(voucherNote(steps)).toBe("這條規則的延遲步驟派券時會用 LINE 通知買家。派券的 LINE 通知僅限擁有者設定。你可以停用、刪除規則或刪除步驟，但不能啟用、新增或修改步驟。");
        expect(steps).not.toContain("編輯步驟：");
        expect(steps.match(/>刪除步驟</gu)).toHaveLength(1);

        const silent = ruleArticle(html, "不通知派券");
        expect(silent).not.toContain("僅限擁有者修改");
        expect(silent).toContain(">啟用<");
        expect(silent).toContain("編輯步驟：事件後 1 小時");
        expect(silent).toContain("立即執行：派發回購券（不發 LINE 通知）");
      });

      it("names a LINE push first when a rule has both", async () => {
        admin();
        mocks.rules.mockResolvedValue([rule({ name: "推播＋派券", actions: [VOUCHER, { type: "line_push", message: "x" }], isActive: false })]);
        const article = ruleArticle(await render(), "推播＋派券");
        expect(article).toContain("這條規則含 LINE 推播。LINE 推播僅限擁有者設定。你可以停用或刪除規則，但不能啟用。");
      });

      it("names both the immediate actions and the delayed step when each of them sends LINE", async () => {
        const push = { type: "line_push", message: "x" };
        const bothNote = (html: string) => html.match(/<p class="[^"]*">([^<]*這條規則和它的延遲步驟[^<]*)<\/p>/u)?.[1] ?? "";
        granted("admin");
        mocks.rules.mockResolvedValue([
          rule({ id: "both-voucher", name: "雙派券", actions: [VOUCHER], isActive: false, steps: [{ id: "s1", delayMinutes: 60, isActive: true, actions: [VOUCHER] }] }),
          rule({ id: "both-mixed", name: "派券加步驟推播", actions: [VOUCHER], isActive: false, steps: [{ id: "s2", delayMinutes: 60, isActive: true, actions: [push] }] }),
        ]);
        const html = await render();
        expect(bothNote(ruleArticle(html, "雙派券"))).toBe("這條規則和它的延遲步驟都會發 LINE 訊息（LINE 推播或派券通知）。派券的 LINE 通知僅限擁有者設定。你可以停用、刪除規則或刪除步驟，但不能啟用、新增或修改步驟。");
        expect(bothNote(ruleArticle(html, "派券加步驟推播"))).toBe("這條規則和它的延遲步驟都會發 LINE 訊息（LINE 推播或派券通知）。LINE 推播僅限擁有者設定。你可以停用、刪除規則或刪除步驟，但不能啟用、新增或修改步驟。");

        // Beta off: the delayed-step section is hidden, and the note says so.
        admin();
        mocks.rules.mockResolvedValue([rule({ name: "隱藏雙推播", actions: [push], isActive: false, steps: [{ id: "s3", delayMinutes: 60, isActive: true, actions: [push] }] })]);
        expect(bothNote(ruleArticle(await render(), "隱藏雙推播"))).toBe("這條規則和它的延遲步驟都會發 LINE 訊息（LINE 推播或派券通知），延遲步驟目前不在此頁顯示。LINE 推播僅限擁有者設定。你可以停用或刪除規則，但不能啟用。");
      });
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

  // Q-18: only the templates that have their link on the rule's trigger are
  // offered; a stored rule that does not fit gets a hint and keeps running.
  describe("e-mail templates by trigger", () => {
    const optionsOf = (markup: string) => [...(markup.match(/<select[^>]*name="emailTemplate"[^>]*>([\s\S]*?)<\/select>/u)?.[1] ?? "").matchAll(/<option value="([^"]*)"[^>]*>([^<]*)<\/option>/gu)].map((match) => `${match[1]}|${match[2]}`);
    const stepsOf = (markup: string) => markup.slice(markup.indexOf("新增延遲步驟"));
    const email = (template: string) => ({ type: "send_email_notification", template });

    it("lists no template on the rule form for the first trigger, whose event carries no link, and explains why", async () => {
      const html = await render();
      expect(optionsOf(html)).toEqual(["|沒有適用的範本"]);
      for (const label of ["諮詢預約確認", "課前提醒", "追購通知", "缺席回放與諮詢邀請"]) expect(html).not.toContain(`>${label}<`);
      expect(html).toContain("「表單報名成功」的事件沒有可放進信裡的連結");
      expect(html).toContain("或同時勾選「發送回購券」使用「追購通知」");
    });

    it.each([
      ["consultation_booked", ["consultation_confirmation|諮詢預約確認"]],
      ["consultation_no_show", ["consultation_confirmation|諮詢預約確認"]],
      ["form_no_show", ["class_reminder|課前提醒", "webinar_replay|缺席回放與諮詢邀請"]],
      ["form_registered", ["|沒有適用的範本"]],
    ])("offers a %s step only the templates with a link", async (trigger, expected) => {
      mocks.manager.mockResolvedValue({ vendor: { id: "v1", betaFeatureGrants: ["automation_delayed_steps", "automation_form_no_show"] }, user: { id: "u1" }, member: { role: "owner" } });
      mocks.rules.mockResolvedValue([rule({ trigger, actions: [{ type: "add_customer_tag", tag: "x" }] })]);
      expect(optionsOf(stepsOf(await render()))).toEqual(expected);
    });

    it("keeps a stored step's own template in its edit form, marked as without a link, and says so on the rule", async () => {
      mocks.manager.mockResolvedValue({ vendor: { id: "v1", betaFeatureGrants: ["automation_delayed_steps"] }, user: { id: "u1" }, member: { role: "owner" } });
      mocks.rules.mockResolvedValue([rule({ trigger: "form_registered", actions: [{ type: "add_customer_tag", tag: "x" }], steps: [{ id: "s1", delayMinutes: 1_440, isActive: true, actions: [email("class_reminder")] }] })]);
      const html = await render();
      const editForm = html.match(/<form[^>]*aria-label="編輯步驟[^"]*"[\s\S]*?<\/form>/u)?.[0] ?? "";
      expect(optionsOf(editForm)).toEqual(["class_reminder|課前提醒（此觸發條件下沒有連結）"]);
      expect(html).toContain("延遲步驟：「課前提醒」在「表單報名成功」下沒有可用的連結，信件可能因為沒有內容而不會寄出。");
      // Advice only: the rule is still listed as running, and its stored step is shown as before.
      expect(html).toContain("啟用中");
      expect(html).toContain("事件後第 1 天");
    });

    it("shows a hint with the templates that fit on a stored rule whose immediate e-mail has no link", async () => {
      mocks.rules.mockResolvedValue([
        rule({ id: "bad", name: "不搭的規則", trigger: "consultation_booked", actions: [email("class_reminder")] }),
        rule({ id: "ok", name: "搭的規則", trigger: "consultation_booked", actions: [email("consultation_confirmation")] }),
      ]);
      const html = await render();
      const section = (name: string) => html.match(new RegExp(`<article[^>]*aria-label="${name}"[\\s\\S]*?</article>`, "u"))?.[0] ?? "";
      expect(section("不搭的規則")).toContain("立即動作：「課前提醒」在「諮詢預約成功」下沒有可用的連結");
      expect(section("不搭的規則")).toContain("建議改用「諮詢預約確認」");
      expect(section("搭的規則")).not.toContain("沒有可用的連結");
    });

    it("accepts 追購通知 on a stored rule that issues its own voucher, and hints when it does not", async () => {
      mocks.rules.mockResolvedValue([
        rule({ id: "with", name: "有派券", trigger: "form_registered", actions: [{ type: "issue_repurchase_voucher", productId: "p1" }, email("repurchase_followup")] }),
        rule({ id: "without", name: "沒派券", trigger: "form_registered", actions: [email("repurchase_followup")] }),
      ]);
      const html = await render();
      const section = (name: string) => html.match(new RegExp(`<article[^>]*aria-label="${name}"[\\s\\S]*?</article>`, "u"))?.[0] ?? "";
      expect(section("有派券")).not.toContain("沒有");
      expect(section("沒派券")).toContain("「追購通知」要有同一份動作裡的「派發回購券」才有領券連結");
    });
  });
