/** Shared between the admin page, its client form and its Server Actions (no server-only imports). */
export const MERCHANT_INVITATION_AUDIT_ACTION = "merchant_registration_invite_created";
export const MERCHANT_INVITATION_REVOKED_AUDIT_ACTION = "merchant_registration_invite_revoked";
export const MERCHANT_INVITATIONS_PATH = "/admin/merchant-invitations";

export type MerchantInvitationActionState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "created"; email: string; link: string; expiresAt: string };

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1_000; // Taiwan has no daylight saving time.

/** Admin-facing timestamps in Taiwan time, `YYYY/MM/DD HH:mm`, independent of ICU data. */
export function formatInvitationTime(value: Date | string) {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  const taipei = new Date(date.getTime() + TAIPEI_OFFSET_MS);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${taipei.getUTCFullYear()}/${pad(taipei.getUTCMonth() + 1)}/${pad(taipei.getUTCDate())} ${pad(taipei.getUTCHours())}:${pad(taipei.getUTCMinutes())}`;
}
