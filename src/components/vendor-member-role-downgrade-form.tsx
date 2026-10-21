import type { ReactNode } from "react";
import { FormSubmitButton } from "@/components/form-submit-button";
import { downgradeRolesFor } from "@/lib/vendor-member-invitation";

/**
 * Owner-only control to lower a member's role at once (#462 m7). Raising a
 * role goes through an invitation the member accepts, so only lower roles are
 * offered; the server action re-checks this and the last-owner invariant.
 */
export function VendorMemberRoleDowngradeForm({
  action,
  csrfField,
  member,
}: {
  action: (formData: FormData) => Promise<void>;
  csrfField: ReactNode;
  member: { id: string; role: string; user: { name: string } };
}) {
  const roles = downgradeRolesFor(member.role);
  if (roles.length === 0) return null;
  return (
    <form action={action} className="flex items-center gap-1">
      {csrfField}
      <input type="hidden" name="id" value={member.id} />
      <label className="sr-only" htmlFor={`downgrade-${member.id}`}>調降 {member.user.name} 的角色</label>
      <select id={`downgrade-${member.id}`} name="role" defaultValue={roles[0]} className="h-8 rounded-md border border-border bg-white px-2 text-xs">
        {roles.map((role) => <option key={role} value={role}>{role}</option>)}
      </select>
      <FormSubmitButton
        pendingChildren="調降中…"
        pendingMessage={`正在調降 ${member.user.name} 的角色，請勿重複送出。`}
        className="rounded-md border border-amber-200 px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-50"
      >
        調降角色
      </FormSubmitButton>
    </form>
  );
}
