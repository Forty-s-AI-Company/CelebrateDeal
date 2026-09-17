import { parseFunnelWebinarSettings, type FunnelWebinarSettings } from "@/lib/funnel-webinar";

/**
 * Funnel flow v1 is intentionally independent from PageDocument.  It keeps
 * the domain workflow and its page references serializable without requiring
 * a database migration while page content continues to live in PageDocument.
 */

export const FUNNEL_FLOW_SCHEMA_VERSION = 1 as const;

export const FUNNEL_GOALS = ["audience", "sell", "custom", "webinar"] as const;
export type FunnelGoal = (typeof FUNNEL_GOALS)[number];

export const FUNNEL_STEP_GROUPS = ["sales", "audience", "general", "webinar", "system"] as const;
export type FunnelStepGroup = (typeof FUNNEL_STEP_GROUPS)[number];

export const FUNNEL_STEP_TYPES = [
  "sales_page", "order_form", "upsell", "downsell", "thank_you_page",
  "opt_in_page", "opt_in_thank_you_page", "inline_form", "popup_form", "link_in_bio",
  "info_page", "contact_us_page",
  "webinar_registration_page", "webinar_thank_you_page", "webinar_broadcast_page",
  "inactive_page",
] as const;
export type FunnelStepType = (typeof FUNNEL_STEP_TYPES)[number];

export type FunnelCapabilityStatus = "available" | "disabled" | "limited" | "unverified";
export type FunnelCapability = { status: FunnelCapabilityStatus; reason: string };
export type FunnelTemplateSource = "template" | "blank" | "system";

export type FunnelStep = {
  schemaVersion: typeof FUNNEL_FLOW_SCHEMA_VERSION;
  id: string;
  name: string;
  path: string;
  type: FunnelStepType;
  template: { source: FunnelTemplateSource; templateId?: string };
  isSystem: boolean;
};

export type FunnelFlow = {
  schemaVersion: typeof FUNNEL_FLOW_SCHEMA_VERSION;
  id: string;
  name: string;
  goal: FunnelGoal;
  domain: string;
  currency: string;
  steps: FunnelStep[];
  capabilities: { webinar: FunnelCapability };
  webinar?: FunnelWebinarSettings;
};

export type FunnelFlowInput = { id: string; name: string; goal: FunnelGoal; domain: string; currency?: string };
export type FunnelStepInput = { id?: string; name: string; path: string; type: Exclude<FunnelStepType, "inactive_page">; templateSource?: Exclude<FunnelTemplateSource, "system">; templateId?: string };
export type FunnelFlowMutationResult = { ok: true; flow: FunnelFlow } | { ok: false; flow: FunnelFlow; error: string };

export type FunnelSecondaryTabId = "configuration" | "automation_rules" | "ab_test" | "stats" | "leads" | "sales" | "deadline_settings" | "funnel_settings";
export type FunnelSecondaryTab = {
  id: FunnelSecondaryTabId;
  label: string;
  capability: FunnelCapability;
  emptyState?: { title: string; columns: readonly string[] };
};

const idPattern = /^[A-Za-z][A-Za-z0-9_-]{0,95}$/u;
const pathPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const templateIdPattern = /^[A-Za-z0-9_-]{1,120}$/u;
const currencyPattern = /^[A-Z]{3}$/u;
let generatedId = 0;

const STEPS: Record<FunnelStepType, { group: FunnelStepGroup; label: string }> = {
  sales_page: { group: "sales", label: "銷售頁" },
  order_form: { group: "sales", label: "訂單表單" },
  upsell: { group: "sales", label: "加購頁" },
  downsell: { group: "sales", label: "降價加購頁" },
  thank_you_page: { group: "sales", label: "感謝頁" },
  opt_in_page: { group: "audience", label: "名單頁" },
  opt_in_thank_you_page: { group: "audience", label: "名單感謝頁" },
  inline_form: { group: "audience", label: "內嵌表單" },
  popup_form: { group: "audience", label: "彈出表單" },
  link_in_bio: { group: "audience", label: "個人簡介連結頁" },
  info_page: { group: "general", label: "資訊頁" },
  contact_us_page: { group: "general", label: "聯絡我們" },
  webinar_registration_page: { group: "webinar", label: "Webinar 報名頁" },
  webinar_thank_you_page: { group: "webinar", label: "Webinar 感謝頁" },
  webinar_broadcast_page: { group: "webinar", label: "Webinar 播放頁" },
  inactive_page: { group: "system", label: "停用頁" },
};

const webinarAvailable: FunnelCapability = {
  status: "available",
  reason: "固定場次 Webinar，依排程導向已綁定的 Live。",
};
const available: FunnelCapability = { status: "available", reason: "在 Funnel 管理中編輯、儲存與查看可信來源資料。" };

function clone<T>(value: T): T {
  if (Array.isArray(value)) return value.map(clone) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, clone(child)])) as T;
  return value;
}

function normalizedText(value: string): string { return value.trim().replace(/\s+/gu, " "); }
function normalizedPath(value: string): string { return value.trim().toLowerCase().replace(/^\/+|\/+$/gu, ""); }
function validName(value: string): boolean { const text = normalizedText(value); return text.length > 0 && text.length <= 160; }
function validId(value: string): boolean { return idPattern.test(value); }
function validPath(value: string): boolean { return pathPattern.test(normalizedPath(value)); }
function failed(flow: FunnelFlow, error: string): FunnelFlowMutationResult { return { ok: false, flow: clone(flow), error }; }
function succeeded(flow: FunnelFlow): FunnelFlowMutationResult { return { ok: true, flow: clone(flow) }; }
function nextId(prefix: string, used: Set<string>): string {
  let candidate = "";
  do { generatedId += 1; candidate = `${prefix}_${generatedId}`; } while (used.has(candidate));
  return candidate;
}

function makeStep(id: string, name: string, path: string, type: FunnelStepType, template: FunnelStep["template"], isSystem = false): FunnelStep {
  return { schemaVersion: FUNNEL_FLOW_SCHEMA_VERSION, id, name, path, type, template, isSystem };
}

function inactiveStep(): FunnelStep {
  return makeStep("inactive", "停用頁", "inactive", "inactive_page", { source: "system" }, true);
}

function defaultSteps(goal: FunnelGoal): FunnelStep[] {
  if (goal === "webinar") return [
    makeStep("webinar_registration", "Webinar 報名頁", "registration", "webinar_registration_page", { source: "template", templateId: "webinar-registration" }),
    makeStep("webinar_thank_you", "Webinar 感謝頁", "thank-you", "webinar_thank_you_page", { source: "template", templateId: "webinar-thank-you" }),
    makeStep("webinar_broadcast", "Webinar 播放頁", "broadcast", "webinar_broadcast_page", { source: "template", templateId: "webinar-broadcast" }),
    inactiveStep(),
  ];
  if (goal === "audience") return [
    makeStep("opt_in", "名單頁", "opt-in", "opt_in_page", { source: "template" }),
    makeStep("opt_in_thank_you", "感謝／下載頁", "thank-you", "opt_in_thank_you_page", { source: "blank" }),
    inactiveStep(),
  ];
  if (goal === "sell") return [
    makeStep("order_form", "訂單表單", "order-form", "order_form", { source: "template" }),
    makeStep("thank_you", "感謝頁", "thank-you", "thank_you_page", { source: "blank" }),
    inactiveStep(),
  ];
  return [inactiveStep()];
}

function validateStep(value: unknown): value is FunnelStep {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const step = value as Partial<FunnelStep>;
  if (step.schemaVersion !== FUNNEL_FLOW_SCHEMA_VERSION || typeof step.id !== "string" || !validId(step.id) || typeof step.name !== "string" || !validName(step.name) || typeof step.path !== "string" || !validPath(step.path) || typeof step.type !== "string" || !(step.type in STEPS) || typeof step.isSystem !== "boolean") return false;
  if (!step.template || typeof step.template !== "object" || Array.isArray(step.template)) return false;
  const template = step.template as FunnelStep["template"];
  if (!["template", "blank", "system"].includes(template.source)) return false;
  if (template.templateId !== undefined && (typeof template.templateId !== "string" || !templateIdPattern.test(template.templateId))) return false;
  if (step.type === "inactive_page" !== step.isSystem) return false;
  if (step.isSystem && template.source !== "system") return false;
  if (!step.isSystem && template.source === "system") return false;
  return true;
}

function hasValidFlowBase(flow: Partial<FunnelFlow>): boolean {
  return flow.schemaVersion === FUNNEL_FLOW_SCHEMA_VERSION
    && typeof flow.id === "string" && validId(flow.id)
    && typeof flow.name === "string" && validName(flow.name)
    && typeof flow.domain === "string" && validPath(flow.domain)
    && typeof flow.currency === "string" && currencyPattern.test(flow.currency)
    && FUNNEL_GOALS.includes(flow.goal as FunnelGoal)
    && Array.isArray(flow.steps)
    && Boolean(flow.capabilities) && typeof flow.capabilities === "object";
}

function hasValidStepCollection(flow: Partial<FunnelFlow>): boolean {
  if (!flow.steps?.every(validateStep)) return false;
  const ids = new Set<string>();
  const paths = new Set<string>();
  let inactiveCount = 0;
  for (const step of flow.steps) {
    if (ids.has(step.id) || paths.has(normalizedPath(step.path))) return false;
    ids.add(step.id); paths.add(normalizedPath(step.path));
    if (step.type === "inactive_page") inactiveCount += 1;
    if (STEPS[step.type].group === "webinar" && flow.goal !== "webinar") return false;
  }
  return inactiveCount === 1;
}

function hasValidWebinarCapability(flow: Partial<FunnelFlow>): boolean {
  const capability = (flow.capabilities as Partial<FunnelFlow["capabilities"]>).webinar;
  if (!capability || !["available", "disabled", "limited", "unverified"].includes(capability.status)) return false;
  if (typeof capability.reason !== "string" || capability.reason.length > 500) return false;
  return true;
}

/** Validate an unknown persistence value without coercion. Invalid values fail closed. */
export function parseFunnelFlow(value: unknown): FunnelFlow | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const flow = value as Partial<FunnelFlow>;
  if (!hasValidFlowBase(flow) || !hasValidStepCollection(flow) || !hasValidWebinarCapability(flow)) return null;
  if (flow.webinar !== undefined && (flow.goal !== "webinar" || !parseFunnelWebinarSettings(flow.webinar))) return null;
  return clone(flow as FunnelFlow);
}

/** The only supported serialize boundary for the no-migration flow document. */
export function serializeFunnelFlow(flow: FunnelFlow): string {
  const parsed = parseFunnelFlow(flow);
  if (!parsed) throw new Error("無法序列化不符合規格的 FunnelFlow");
  return JSON.stringify(parsed);
}

export function deserializeFunnelFlow(serialized: string): FunnelFlow | null {
  if (serialized.length > 1_000_000) return null;
  try { return parseFunnelFlow(JSON.parse(serialized) as unknown); } catch { return null; }
}

/** 建立獨立頁面所需的流程 metadata。 */
export function createFunnelFlow(input: FunnelFlowInput): FunnelFlow | null {
  if (!validId(input.id) || !validName(input.name) || !validPath(input.domain)) return null;
  const currency = (input.currency ?? "TWD").toUpperCase();
  if (!currencyPattern.test(currency)) return null;
  return parseFunnelFlow({
    schemaVersion: FUNNEL_FLOW_SCHEMA_VERSION,
    id: input.id,
    name: normalizedText(input.name),
    goal: input.goal,
    domain: normalizedPath(input.domain),
    currency,
    steps: defaultSteps(input.goal),
    capabilities: { webinar: webinarAvailable },
    ...(input.goal === "webinar" ? { webinar: { timezone: "Asia/Taipei", startsAt: null, endsAt: null, replayEndsAt: null } } : {}),
  });
}

export function getFunnelStepCatalog(): ReadonlyArray<{ type: FunnelStepType; group: FunnelStepGroup; label: string; capability: FunnelCapability }> {
  return FUNNEL_STEP_TYPES.map((type) => ({
    type,
    group: STEPS[type].group,
    label: STEPS[type].label,
    capability: STEPS[type].group === "webinar" ? webinarAvailable : type === "inactive_page" ? { status: "disabled", reason: "停用頁由系統管理，不能手動新增。" } : available,
  }));
}

function validFlow(flow: FunnelFlow): FunnelFlow | null { return parseFunnelFlow(flow); }
function stepIndex(flow: FunnelFlow, stepId: string): number { return flow.steps.findIndex((step) => step.id === stepId); }
function mutationFlow(flow: FunnelFlow, mutate: (next: FunnelFlow) => string | null): FunnelFlowMutationResult {
  const parsed = validFlow(flow);
  if (!parsed) return failed(flow, "Funnel 流程資料無法通過驗證，拒絕修改");
  const next = clone(parsed);
  const error = mutate(next);
  if (error) return failed(parsed, error);
  const verified = parseFunnelFlow(next);
  return verified ? succeeded(verified) : failed(parsed, "修改後的 Funnel 流程不符合資料規格，已回復原狀");
}

export function addFunnelStep(flow: FunnelFlow, input: FunnelStepInput, index?: number): FunnelFlowMutationResult {
  return mutationFlow(flow, (next) => {
    if (!(input.type in STEPS)) return "此步驟類型不可手動新增";
    if (STEPS[input.type].group === "webinar" && next.goal !== "webinar") return "Webinar 步驟只能新增至 Webinar Funnel";
    if (!validName(input.name) || !validPath(input.path)) return "步驟名稱或 URL Path 不符合格式";
    const source = input.templateSource ?? (input.templateId ? "template" : "blank");
    if (source === "template" && (!input.templateId || !templateIdPattern.test(input.templateId))) return "選擇模板時必須提供安全的 template ID";
    if (input.templateId && !templateIdPattern.test(input.templateId)) return "template ID 格式不正確";
    if (next.steps.some((step) => step.path === normalizedPath(input.path))) return "URL Path 已被其他步驟使用";
    const used = new Set(next.steps.map((step) => step.id));
    const id = input.id ?? nextId("step", used);
    if (!validId(id) || used.has(id)) return "步驟 ID 無效或重複";
    const step = makeStep(id, normalizedText(input.name), normalizedPath(input.path), input.type, { source, ...(input.templateId ? { templateId: input.templateId } : {}) });
    const at = index === undefined ? Math.max(0, next.steps.length - 1) : index;
    if (!Number.isInteger(at) || at < 0 || at > next.steps.length - 1) return "新增位置無效";
    next.steps.splice(at, 0, step);
    return null;
  });
}

export function renameFunnelStep(flow: FunnelFlow, stepId: string, name: string): FunnelFlowMutationResult {
  return mutationFlow(flow, (next) => {
    const index = stepIndex(next, stepId);
    if (index < 0) return "找不到指定步驟";
    if (next.steps[index]?.isSystem) return "停用頁由系統管理，不能重新命名";
    if (!validName(name)) return "步驟名稱必須介於 1 到 160 個字元";
    next.steps[index]!.name = normalizedText(name);
    return null;
  });
}

export function setFunnelStepPath(flow: FunnelFlow, stepId: string, path: string): FunnelFlowMutationResult {
  return mutationFlow(flow, (next) => {
    const index = stepIndex(next, stepId);
    if (index < 0) return "找不到指定步驟";
    if (next.steps[index]?.isSystem) return "停用頁由系統管理，不能修改 URL Path";
    const normalized = normalizedPath(path);
    if (!validPath(normalized)) return "URL Path 只能使用小寫英文、數字與連字號";
    if (next.steps.some((step, stepIndexValue) => stepIndexValue !== index && step.path === normalized)) return "URL Path 已被其他步驟使用";
    next.steps[index]!.path = normalized;
    return null;
  });
}

export function setFunnelStepTemplate(flow: FunnelFlow, stepId: string, templateId: string): FunnelFlowMutationResult {
  return mutationFlow(flow, (next) => {
    const index = stepIndex(next, stepId);
    if (index < 0) return "找不到指定步驟";
    if (next.steps[index]?.isSystem) return "停用頁不支援頁面模板";
    if (!templateIdPattern.test(templateId)) return "template ID 格式不正確";
    next.steps[index]!.template = { source: "template", templateId };
    return null;
  });
}

export function duplicateFunnelStep(flow: FunnelFlow, stepId: string, input: Pick<FunnelStepInput, "id" | "name" | "path">): FunnelFlowMutationResult {
  return mutationFlow(flow, (next) => {
    const index = stepIndex(next, stepId);
    const original = next.steps[index];
    if (!original) return "找不到指定步驟";
    if (original.isSystem) return "停用頁由系統管理，不能複製";
    if (!validName(input.name) || !validPath(input.path)) return "副本名稱或 URL Path 不符合格式";
    const used = new Set(next.steps.map((step) => step.id));
    const id = input.id ?? nextId("step", used);
    if (!validId(id) || used.has(id)) return "副本步驟 ID 無效或重複";
    const path = normalizedPath(input.path);
    if (next.steps.some((step) => step.path === path)) return "URL Path 已被其他步驟使用";
    next.steps.splice(index + 1, 0, { ...clone(original), id, name: normalizedText(input.name), path });
    return null;
  });
}

export function moveFunnelStep(flow: FunnelFlow, stepId: string, toIndex: number): FunnelFlowMutationResult {
  return mutationFlow(flow, (next) => {
    const index = stepIndex(next, stepId);
    if (index < 0) return "找不到指定步驟";
    if (next.steps[index]?.isSystem) return "停用頁由系統管理，不能移動";
    const inactiveIndex = next.steps.findIndex((step) => step.isSystem);
    if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= inactiveIndex) return "移動位置無效，停用頁必須維持在流程最後";
    const [step] = next.steps.splice(index, 1);
    next.steps.splice(toIndex, 0, step!);
    return null;
  });
}

export function removeFunnelStep(flow: FunnelFlow, stepId: string): FunnelFlowMutationResult {
  return mutationFlow(flow, (next) => {
    const index = stepIndex(next, stepId);
    if (index < 0) return "找不到指定步驟";
    if (next.steps[index]?.isSystem) return "停用頁由系統管理，不能移除";
    next.steps.splice(index, 1);
    return null;
  });
}

/** Operational tabs are backed by persisted settings and server-owned sources. */
export function getFunnelSecondaryTabs(flow: FunnelFlow): ReadonlyArray<FunnelSecondaryTab> {
  if (!validFlow(flow)) return [];
  return [
    { id: "configuration", label: "設定", capability: available },
    { id: "automation_rules", label: "Automation Rules", capability: available },
    { id: "ab_test", label: "A/B Test", capability: available },
    { id: "stats", label: "Stats", capability: available },
    { id: "leads", label: "Leads", capability: available },
    { id: "sales", label: "Sales", capability: available },
    { id: "deadline_settings", label: "Deadline Settings", capability: available },
    { id: "funnel_settings", label: "Funnel Settings", capability: available },
  ];
}
