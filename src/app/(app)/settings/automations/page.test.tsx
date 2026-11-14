import { renderToStaticMarkup } from "react-dom/server"; import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ manager: vi.fn(), products: vi.fn(), rules: vi.fn(), logs: vi.fn(), runCounts: vi.fn() })); vi.mock("@/lib/auth", () => ({ requireVendorManagerMember: mocks.manager })); vi.mock("@/lib/db", () => ({ getDb: () => ({ product: { findMany: mocks.products }, automationRule: { findMany: mocks.rules }, automationExecutionLog: { findMany: mocks.logs }, delayedStepRun: { groupBy: mocks.runCounts } }) })); vi.mock("@/app/actions/automation-actions", () => ({ createAutomationRuleAction: vi.fn(), createAutomationRecipeAction: vi.fn(), deleteAutomationRuleAction: vi.fn(), dryRunAutomationRuleAction: vi.fn(), toggleAutomationRuleAction: vi.fn(), createAutomationRuleStepAction: vi.fn(), updateAutomationRuleStepAction: vi.fn(), deleteAutomationRuleStepAction: vi.fn() })); vi.mock("@/components/csrf-field", () => ({ CsrfField: () => <input type="hidden" name="csrf" /> }));
import Page from "./page";
const rule = (overrides: Record<string, unknown>) => ({ id: "r1", name: "報名回購", trigger: "form_registered", condition: { type: "always" }, actions: [{ type: "line_push" }], isActive: true, createdAt: new Date("2026-01-01"), _count: { executionLogs: 0 }, steps: [], ...overrides });
beforeEach(() => { vi.clearAllMocks(); mocks.manager.mockResolvedValue({ vendor: { id: "v1" }, user: { id: "u1" }, member: { role: "admin" } }); mocks.products.mockResolvedValue([{ id: "p1", name: "課程" }]); mocks.runCounts.mockResolvedValue([]); mocks.rules.mockResolvedValue([rule({})]); mocks.logs.mockResolvedValue([{ id: "l1", eventId: "form-registered:s1", rule: { name: "報名回購" }, trigger: "form_registered", subjectKeyHash: "abcdefgh12345678", status: "failed", errorCode: "action_failed", actionResults: null, createdAt: new Date("2026-01-02") }]); });
const render = async (searchParams: Record<string, string> = {}) => renderToStaticMarkup(await Page({ searchParams: Promise.resolve(searchParams) }));
describe("AutomationSettingsPage", () => {
  it("renders recipes, visual rules, dry-run and masked logs for an owner or admin", async () => {
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
    expect([...triggerSelect.matchAll(/value="([^"]+)"/gu)].map((match) => match[1])).toEqual(["form_registered", "consultation_booked", "consultation_no_show"]);
    for (const hiddenRecipe of ["高意向追單漏斗", "高客單 VIP 自動尊榮升級", "開播缺席喚醒再行銷"]) expect(html).not.toContain(hiddenRecipe);
    // No available trigger takes a threshold, so the field is not shown.
    expect(html).not.toContain('name="conditionValue"');
  });

  it("keeps listing a rule on a hidden trigger, explains it, and only offers switching off and deleting", async () => {
    mocks.rules.mockResolvedValue([
      rule({ id: "paid-on", name: "付款回購", trigger: "payment_paid", condition: { type: "order_amount_gte", amountCents: 10000 }, isActive: true }),
      rule({ id: "noshow-off", name: "缺席喚醒", trigger: "form_no_show", isActive: false }),
    ]);
    const html = await render();
    expect(html).toContain("付款回購");
    expect(html).toContain("觸發：訂單付款完成");
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

  const granted = () => mocks.manager.mockResolvedValue({ vendor: { id: "v1", betaFeatureGrants: ["automation_delayed_steps"] }, user: { id: "u1" }, member: { role: "admin" } });

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

  it.each([
    ["updated", "step_created", "延遲步驟已新增。"],
    ["error", "duplicate_delay", "同一條規則已經有這個延遲時間的步驟"],
    ["error", "step_limit", "每條規則最多 10 個延遲步驟"],
    ["error", "invalid_delay", "1 小時到 90 天"],
    ["error", "trigger_unavailable", "這個觸發條件目前不會執行，不能用來建立或啟用規則。"],
    ["error", "delete_has_history", "只能停用、不能刪除"],
    ["dryRun", "trigger_unavailable", "這條規則的觸發條件目前不會執行"],
    ["error", "toggle_conflict", "規則剛被其他人變更，請重新整理後再試。"],
    ["error", "delete_busy", "規則正在執行，請稍後再試。"],
  ])("explains %s=%s", async (key, value, message) => {
    expect(await render({ [key]: value })).toContain(message);
  });
});
