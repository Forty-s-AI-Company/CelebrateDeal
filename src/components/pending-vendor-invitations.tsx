import type { ReactNode } from "react";
import { FormSubmitButton } from "@/components/form-submit-button";
import { getDb } from "@/lib/db";
import { vendorMemberRoleLabel } from "@/lib/vendor-roles";

export type PendingVendorInvitation = { id: string; email: string; role: string; expiresAt: Date };

/** Pending, unexpired invitations of the session vendor (owner view, F-029). */
export async function loadPendingVendorInvitations(isOwner: boolean, vendorId: string | undefined): Promise<PendingVendorInvitation[]> {
  if (!isOwner || !vendorId) return [];
  return getDb().vendorMemberInvitation.findMany({
    where: { vendorId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
    select: { id: true, email: true, role: true, expiresAt: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

/**
 * Lists every pending invitation the same way, whatever the address belongs
 * to, so the list cannot reveal platform administrators or suspended accounts.
 */
export function PendingVendorInvitations({
  invitations,
  action,
  csrfField,
}: {
  invitations: PendingVendorInvitation[];
  action: (formData: FormData) => Promise<void>;
  csrfField: ReactNode;
}) {
  if (invitations.length === 0) return null;
  return (
    <div className="mb-5 overflow-hidden rounded-lg border border-border">
      <p className="bg-slate-50 px-4 py-2 text-xs font-semibold uppercase text-slate-500">待接受的邀請</p>
      <ul className="divide-y divide-border">
        {invitations.map((invitation) => (
          <li key={invitation.id} className="flex flex-col gap-2 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="break-all font-semibold text-slate-900">{invitation.email}</p>
              <p className="text-xs text-slate-500">{vendorMemberRoleLabel(invitation.role)} · {invitation.expiresAt.toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })} 前有效</p>
            </div>
            <form action={action}>
              {csrfField}
              <input type="hidden" name="invitationId" value={invitation.id} />
              <FormSubmitButton
                pendingChildren="撤銷中…"
                pendingMessage={`正在撤銷寄給 ${invitation.email} 的邀請，請勿重複送出。`}
                className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50"
              >
                撤銷邀請
              </FormSubmitButton>
            </form>
          </li>
        ))}
      </ul>
    </div>
  );
}
