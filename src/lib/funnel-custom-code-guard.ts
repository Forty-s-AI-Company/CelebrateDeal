import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import {
  collectFunnelCustomCode,
  contentHasCustomCode,
  contentHasCustomScript,
  diffFunnelCustomCode,
  FUNNEL_CUSTOM_CODE_FIELDS,
  isFunnelCustomCodeDisabled,
  utf8ByteLength,
  type FunnelCustomCodeChange,
} from "@/lib/funnel-custom-code";

/**
 * 伺服器端的自訂程式碼閘門。所有寫入 LandingPage.draftContent 的路徑
 * （建立、儲存、步驟中繼資料、回復歷史版本、複製頁面）都比對新舊內容後
 * 呼叫 `assertFunnelCustomCodeWrite`；發布呼叫 `assertFunnelCustomCodePublish`。
 */
export const FUNNEL_CUSTOM_CODE_MANAGER_ROLES = ["owner", "admin"] as const;

export type FunnelCustomCodeActor = { userId: string; role: string | null; emailVerified: boolean };

export type FunnelCustomCodeRefusalCode =
  | "landing_page_custom_code_role"
  | "landing_page_custom_code_email_unverified"
  | "landing_page_custom_code_disabled";

export class FunnelCustomCodeRefusal extends Error {
  constructor(readonly code: FunnelCustomCodeRefusalCode) {
    super(code);
    this.name = "FunnelCustomCodeRefusal";
  }
}

function canManageCustomCode(role: string | null): boolean {
  return FUNNEL_CUSTOM_CODE_MANAGER_ROLES.includes(role as (typeof FUNNEL_CUSTOM_CODE_MANAGER_ROLES)[number]);
}

/**
 * 1. 任何自訂程式碼或頁面自訂 CSS 的新增、修改、刪除，只有 owner／admin 可以。
 * 2. 只要新內容含有非空 JS（不論這次是否改到 JS），儲存者的 Email 必須已驗證。
 * 3. 緊急開關啟用時，不接受新增或修改 JS（刪除仍可以）。
 * 回傳的變動清單只含位置、欄位與大小，供稽核使用。
 */
export function assertFunnelCustomCodeWrite(actor: FunnelCustomCodeActor, previous: unknown, next: unknown, env: Record<string, string | undefined> = process.env): FunnelCustomCodeChange[] {
  const changes = diffFunnelCustomCode(previous, next);
  if (changes.length && !canManageCustomCode(actor.role)) throw new FunnelCustomCodeRefusal("landing_page_custom_code_role");
  if (contentHasCustomScript(next) && !actor.emailVerified) throw new FunnelCustomCodeRefusal("landing_page_custom_code_email_unverified");
  if (isFunnelCustomCodeDisabled(env) && changes.some((change) => change.scriptAddedOrChanged)) throw new FunnelCustomCodeRefusal("landing_page_custom_code_disabled");
  return changes;
}

/** 發布（讓自訂程式碼上線）同樣只限 owner／admin；含 JS 時發布者 Email 必須已驗證。 */
export function assertFunnelCustomCodePublish(actor: FunnelCustomCodeActor, content: unknown): boolean {
  if (!contentHasCustomCode(content)) return false;
  if (!canManageCustomCode(actor.role)) throw new FunnelCustomCodeRefusal("landing_page_custom_code_role");
  if (contentHasCustomScript(content) && !actor.emailVerified) throw new FunnelCustomCodeRefusal("landing_page_custom_code_email_unverified");
  return true;
}

/** 刪除或封存含自訂程式碼的頁面，同樣只限 owner／admin。 */
export function assertFunnelCustomCodeDelete(actor: FunnelCustomCodeActor, ...contents: unknown[]) {
  if (contents.some(contentHasCustomCode) && !canManageCustomCode(actor.role)) throw new FunnelCustomCodeRefusal("landing_page_custom_code_role");
}

type AuditClient = { auditLog: Pick<Prisma.TransactionClient["auditLog"], "create"> };

/** 程式碼的指紋（SHA-256 前 16 碼），用來追蹤哪個版本上線；不存程式碼本身。 */
function fingerprint(parts: string[]): string {
  return createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 16);
}

/** 儲存時的稽核：只記錄位置、變動種類、欄位與位元組數。 */
export async function recordFunnelCustomCodeSave(client: AuditClient, input: { vendorId: string; actorId: string; pageId: string; operation: string; changes: FunnelCustomCodeChange[] }) {
  if (!input.changes.length) return;
  await client.auditLog.create({ data: {
    vendorId: input.vendorId,
    actorId: input.actorId,
    action: "funnel_custom_code_saved",
    targetType: "LandingPage",
    targetId: input.pageId,
    after: {
      operation: input.operation,
      changes: input.changes.map(({ location, kind, change, fields, bytes }) => ({ location, kind, change, fields, bytes })),
    } as Prisma.InputJsonValue,
  } });
}

/** 發布時的稽核：上線內容中每段自訂程式碼的位置、大小與指紋。 */
export async function recordFunnelCustomCodePublish(client: AuditClient, input: { vendorId: string; actorId: string; pageId: string; version: number; content: unknown; env?: Record<string, string | undefined> }) {
  const inventory = collectFunnelCustomCode(input.content);
  if (!inventory.nodes.size && !inventory.pageCss.size) return;
  await client.auditLog.create({ data: {
    vendorId: input.vendorId,
    actorId: input.actorId,
    action: "funnel_custom_code_published",
    targetType: "LandingPage",
    targetId: input.pageId,
    after: {
      version: input.version,
      killSwitchActive: isFunnelCustomCodeDisabled(input.env ?? process.env),
      nodes: [...inventory.nodes.values()].map((entry) => ({
        location: entry.location,
        bytes: Object.fromEntries(FUNNEL_CUSTOM_CODE_FIELDS.map((field) => [field, utf8ByteLength(entry[field])])),
        sha256: fingerprint([entry.html, entry.css, entry.js]),
      })),
      pageCss: [...inventory.pageCss.values()].map((entry) => ({ location: entry.location, bytes: utf8ByteLength(entry.css), sha256: fingerprint([entry.css]) })),
    } as Prisma.InputJsonValue,
  } });
}
