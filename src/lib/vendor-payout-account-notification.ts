import type { PrismaClient } from "@prisma/client";
import { sendTransactionalEmail } from "@/lib/email";
import { publicSupportContact } from "@/lib/public-policy-content";

type ChangeNotice = {
  vendorId: string;
  vendorName: string;
  accountId: string;
  accountNumberLast4: string;
  changedAt: Date;
  payoutEligibleAt: Date;
};

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function taipeiTime(value: Date) {
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    dateStyle: "medium",
    timeStyle: "short",
    hour12: false,
  }).format(value);
}

/**
 * F-073: e-mails every active owner of the vendor that the payout bank account
 * changed. The message carries only the last four digits and the time the
 * account becomes usable, never the full account. Returns false when any
 * owner could not be notified; the caller records that and tells the user,
 * while the 24-hour cooldown still applies.
 */
export async function notifyOwnersOfPayoutAccountChange(db: PrismaClient, notice: ChangeNotice) {
  const owners = await db.vendorMember.findMany({
    where: { vendorId: notice.vendorId, role: "owner", status: "active" },
    select: { user: { select: { email: true } } },
  });
  const recipients = [...new Set(owners.map((owner) => owner.user.email).filter((email): email is string => Boolean(email)))];
  if (recipients.length === 0) return false;

  const changedAt = taipeiTime(notice.changedAt);
  const eligibleAt = taipeiTime(notice.payoutEligibleAt);
  const support = publicSupportContact.email;
  const subject = "CelebrateDeal 撥款帳號已變更";
  const text = [
    `「${notice.vendorName}」的撥款銀行帳號已於 ${changedAt}（台北時間）變更為末四碼 ${notice.accountNumberLast4} 的帳戶。`,
    `為了安全，新帳號要到 ${eligibleAt} 之後才會用於撥款。`,
    `如果不是你或其他擁有者操作，請立即登入檢查並聯絡 ${support}。`,
  ].join("\n\n");
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.7;color:#0f172a">
      <h2 style="margin:0 0 12px">撥款帳號已變更</h2>
      <p>「${escapeHtml(notice.vendorName)}」的撥款銀行帳號已於 ${escapeHtml(changedAt)}（台北時間）變更為末四碼 <strong>${escapeHtml(notice.accountNumberLast4)}</strong> 的帳戶。</p>
      <p>為了安全，新帳號要到 ${escapeHtml(eligibleAt)} 之後才會用於撥款。</p>
      <p>如果不是你或其他擁有者操作，請立即登入檢查並聯絡 ${escapeHtml(support)}。</p>
    </div>
  `;

  let allSent = true;
  for (const to of recipients) {
    try {
      await sendTransactionalEmail({
        to,
        subject,
        text,
        html,
        idempotencyKey: `payout-account-changed:${notice.accountId}:${notice.changedAt.getTime()}:${Buffer.from(to).toString("base64url").slice(0, 120)}`,
      });
    } catch {
      allSent = false;
    }
  }
  return allSent;
}
