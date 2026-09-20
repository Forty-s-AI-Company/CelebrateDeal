"use server";

import { assertServerActionSecurity } from "@/lib/csrf";
import {
  createFunnelAutomationRule,
  FunnelAutomationConflictError,
  FunnelAutomationInputError,
  FunnelAutomationNotFoundError,
  FunnelAutomationScopeError,
  listFunnelAutomationRules,
  setFunnelAutomationRuleEnabled,
  updateFunnelAutomationRule,
  type FunnelAutomationRule,
} from "@/lib/funnel-automation-service";

export type FunnelAutomationActionState = {
  status: "success" | "error";
  message: string;
  rules?: FunnelAutomationRule[];
};

function text(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

function number(formData: FormData, name: string) {
  const raw = text(formData, name);
  return /^\d+$/u.test(raw) ? Number(raw) : NaN;
}

function failure(error: unknown): FunnelAutomationActionState {
  if (error instanceof FunnelAutomationConflictError) return { status: "error", message: "這條規則已有較新的版本，系統沒有覆蓋它。請重新載入後再試。" };
  if (error instanceof FunnelAutomationScopeError) return { status: "error", message: "請先選擇一個銷售專案後再管理漏斗自動化。" };
  if (error instanceof FunnelAutomationNotFoundError) return { status: "error", message: "找不到這個漏斗或規則，或你沒有管理權限。" };
  if (error instanceof FunnelAutomationInputError) return { status: "error", message: "規則資料不完整或格式不正確，請確認後再試。" };
  return { status: "error", message: "暫時無法更新自動化規則；你的輸入仍保留在畫面上。" };
}

async function secure(formData: FormData) {
  await assertServerActionSecurity(formData);
  return text(formData, "pageId");
}

/** The client component self-loads this minimal, tenant-scoped projection. */
export async function listFunnelAutomationRulesAction(formData: FormData): Promise<FunnelAutomationActionState> {
  try {
    const pageId = await secure(formData);
    return { status: "success", message: "", rules: await listFunnelAutomationRules({ pageId }) };
  } catch (error) {
    return failure(error);
  }
}

export async function createFunnelAutomationRuleAction(formData: FormData): Promise<FunnelAutomationActionState> {
  try {
    const pageId = await secure(formData);
    await createFunnelAutomationRule({ pageId, name: text(formData, "name"), tag: text(formData, "tag") });
    return { status: "success", message: "規則已建立。", rules: await listFunnelAutomationRules({ pageId }) };
  } catch (error) {
    return failure(error);
  }
}

export async function updateFunnelAutomationRuleAction(formData: FormData): Promise<FunnelAutomationActionState> {
  try {
    const pageId = await secure(formData);
    await updateFunnelAutomationRule({ pageId, ruleId: text(formData, "ruleId"), version: number(formData, "version"), name: text(formData, "name"), tag: text(formData, "tag") });
    return { status: "success", message: "規則已更新。", rules: await listFunnelAutomationRules({ pageId }) };
  } catch (error) {
    return failure(error);
  }
}

export async function setFunnelAutomationRuleEnabledAction(formData: FormData): Promise<FunnelAutomationActionState> {
  try {
    const pageId = await secure(formData);
    const active = text(formData, "isActive");
    if (active !== "true" && active !== "false") throw new FunnelAutomationInputError();
    await setFunnelAutomationRuleEnabled({ pageId, ruleId: text(formData, "ruleId"), version: number(formData, "version"), isActive: active === "true" });
    return { status: "success", message: active === "true" ? "規則已啟用。" : "規則已停用。", rules: await listFunnelAutomationRules({ pageId }) };
  } catch (error) {
    return failure(error);
  }
}
