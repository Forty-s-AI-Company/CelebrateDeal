import { CsrfField } from "@/components/csrf-field";

type VendorMemberDeactivationAction = (formData: FormData) => void | Promise<void>;

export type VendorMemberForDeactivation = {
  id: string;
  userId: string;
  status: string;
  user: {
    name: string;
    email: string;
  };
};

export function VendorMemberDeactivationConfirmation({
  action,
  currentUserId,
  isOwner,
  member,
  csrfToken,
}: {
  action: VendorMemberDeactivationAction;
  currentUserId: string;
  isOwner: boolean;
  member: VendorMemberForDeactivation;
  csrfToken?: string;
}) {
  const canDeactivate = isOwner && member.status === "active" && member.userId !== currentUserId;

  if (!canDeactivate) return null;

  return (
    <form action={action} className="grid justify-items-end gap-2">
      {csrfToken ? <input type="hidden" name="_csrf" value={csrfToken} /> : <CsrfField />}
      <input type="hidden" name="id" value={member.id} />
      <label className="grid gap-1 text-left text-xs text-slate-600">
        <span>輸入 {member.user.email} 以確認停用</span>
        <input
          aria-label={`確認停用 ${member.user.name}`}
          className="h-8 w-52 rounded-md border border-red-200 bg-white px-2 text-xs outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100"
          name="confirmation"
          type="email"
          autoComplete="off"
          required
        />
      </label>
      <button className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50">確認停用</button>
    </form>
  );
}
