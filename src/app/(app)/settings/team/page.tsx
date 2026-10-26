import {
  addTeamMemberAction,
  createSalesTeamAction,
  deactivateTeamMembershipAction,
  setTeamMembershipAffiliateAction,
  setTeamUplineAction,
  transferTeamMemberAction,
} from "@/app/actions/team-membership-actions";
import { CsrfField } from "@/components/csrf-field";
import { Badge, Card, DangerButton, Field, PageHeader, SelectField, SubmitButton } from "@/components/ui";
import { requireVendorOwner } from "@/lib/auth";
import { getDb } from "@/lib/db";

const errorMessages: Record<string, string> = {
  team_invalid: "請確認團隊名稱與網址，且團隊必須屬於目前商家。",
  team_conflict: "團隊網址已存在，請換一個名稱。",
  member_invalid: "請選擇目前商家中的 active 成員。",
  member_exists: "這位成員已在團隊中。",
  member_conflict: "成員加入與其他操作衝突，請重新整理後再試。",
  membership_invalid: "找不到可操作的 active 團隊成員。",
  membership_exists: "這位成員已經在團隊中。",
  relationship_invalid: "請確認團隊與成員關係資料。",
  relationship_conflict: "上下線關係有衝突，請重新整理後再試。",
  upline_invalid: "指定的上線不是同一團隊中的 active 成員。",
  self_upline: "成員不能指定自己為上線。",
  upline_cycle: "這個指定會形成循環上下線關係，已拒絕儲存。",
  self_membership: "不能停用自己目前使用中的團隊 membership。",
  team_move_invalid: "請確認來源團隊、目標團隊與成員資料，且不能移到同一團隊。",
  team_move_conflict: "這位成員已在目標團隊中，或轉組與其他操作衝突。",
  affiliate_binding_invalid: "請確認要綁定的團隊成員與推廣夥伴。",
  affiliate_invalid: "找不到這個商家的推廣夥伴，請重新整理後再試。",
  affiliate_inactive: "這位推廣夥伴已停用，請先在推廣夥伴頁啟用後再綁定。",
  affiliate_taken: "這位推廣夥伴已綁定其他團隊成員，請先解除原本的綁定。",
  affiliate_taken_inactive: "這位推廣夥伴綁定在已停用的成員紀錄上，請先在「已停用成員紀錄上的綁定」解除。",
  affiliate_binding_conflict: "推廣夥伴綁定與其他操作衝突，請重新整理後再試。",
};

const updatedMessages: Record<string, string> = {
  team_created: "團隊已建立，建立者已自動加入。",
  member_added: "團隊成員已加入。",
  relationship_saved: "上下線關係已更新，歷史關係已保留。",
  member_deactivated: "團隊成員已停用，相關 active 上下線關係已結束，並已一併解除推廣夥伴綁定。",
  member_transferred: "團隊成員已轉移，原團隊上下線關係已結束，推廣夥伴綁定已隨成員移到新團隊。",
  affiliate_bound: "推廣夥伴已綁定，之後的新訂單會依此計算團隊上線佣金。",
  affiliate_unbound: "已解除推廣夥伴綁定，之後的新訂單不再發放這位成員的團隊上線佣金。",
  affiliate_unchanged: "推廣夥伴綁定沒有變更。",
};

type AffiliateOption = { id: string; name: string; code: string; contactEmail: string | null };

/** Display-only comparison; binding always requires an explicit owner action. */
function normalizedEmail(value: string | null | undefined) {
  const email = value?.trim().toLowerCase() ?? "";
  return email || null;
}

export default async function TeamSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ updated?: string; error?: string }>;
}) {
  const params = await searchParams;
  const auth = await requireVendorOwner();
  const db = getDb();
  const [teams, members, affiliates, boundMemberships] = await Promise.all([
    db.salesTeam.findMany({
      where: { vendorId: auth.vendor.id },
      orderBy: { createdAt: "asc" },
      include: {
        memberships: {
          where: { status: "ACTIVE", leftAt: null },
          orderBy: { createdAt: "asc" },
          include: {
            vendorMember: { include: { user: { select: { name: true, email: true } } } },
            uplineRelationships: { where: { endedAt: null }, select: { uplineMembershipId: true } },
            affiliate: { select: { id: true, name: true, code: true, isActive: true } },
          },
        },
      },
    }),
    db.vendorMember.findMany({
      where: { vendorId: auth.vendor.id, status: "active" },
      orderBy: { createdAt: "asc" },
      include: { user: { select: { name: true, email: true } } },
    }),
    db.affiliate.findMany({
      where: { vendorId: auth.vendor.id, isActive: true },
      orderBy: [{ name: "asc" }, { createdAt: "asc" }],
      select: { id: true, name: true, code: true, contactEmail: true },
    }),
    db.teamMembership.findMany({
      where: { vendorId: auth.vendor.id, affiliateId: { not: null } },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        affiliateId: true,
        status: true,
        leftAt: true,
        team: { select: { name: true } },
        vendorMember: { select: { user: { select: { name: true, email: true } } } },
        affiliate: { select: { name: true, code: true } },
      },
    }),
  ]);
  const affiliateHolder = new Map<string, { id: string; inactive: boolean }>();
  for (const bound of boundMemberships) {
    if (bound.affiliateId) affiliateHolder.set(bound.affiliateId, { id: bound.id, inactive: bound.status !== "ACTIVE" || bound.leftAt !== null });
  }
  // A binding left on an inactive record blocks the affiliate, so it is listed
  // separately with a release control (the action only allows releasing it).
  const inactiveBindings = boundMemberships.filter((bound) => bound.status !== "ACTIVE" || bound.leftAt !== null);
  const unboundAffiliatesByEmail = new Map<string, AffiliateOption[]>();
  for (const affiliate of affiliates) {
    const email = normalizedEmail(affiliate.contactEmail);
    if (!email || affiliateHolder.has(affiliate.id)) continue;
    unboundAffiliatesByEmail.set(email, [...(unboundAffiliatesByEmail.get(email) ?? []), affiliate]);
  }

  return (
    <>
      <PageHeader title="團隊管理" description="建立銷售團隊、加入商家成員，並以可追溯的關係設定 payout 與展業歸屬。" />
      {params.updated ? <p role="status" className="mb-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{updatedMessages[params.updated] ?? "已更新。"}</p> : null}
      {params.error ? <p role="alert" className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessages[params.error] ?? "操作失敗，請重新整理後再試。"}</p> : null}

      <Card className="mb-5">
        <h2 className="mb-1 text-lg font-semibold text-slate-950">建立團隊</h2>
        <p className="mb-4 text-sm text-slate-600">建立後 擁有者會自動加入，網址只用於內部識別。</p>
        <form action={createSalesTeamAction} className="grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
          <CsrfField />
          <Field label="團隊名稱" name="name" placeholder="例如：北區夥伴團隊" required maxLength={80} />
          <Field label="網址（可留白自動產生）" name="slug" placeholder="north-partners" maxLength={80} />
          <SubmitButton>建立團隊</SubmitButton>
        </form>
      </Card>

      <div className="grid gap-5">
        {teams.length === 0 ? (
          <Card><p className="text-sm text-slate-600">目前還沒有團隊，先建立第一個團隊即可開始分配成員。</p></Card>
        ) : teams.map((team) => (
          <Card key={team.id}>
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">{team.name}</h2>
                <p className="mt-1 text-xs text-slate-500">網址：{team.slug} · {team.memberships.length} 位 active 成員</p>
              </div>
              <Badge tone="green">owner 管理</Badge>
            </div>

            <form action={addTeamMemberAction} className="mb-5 grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
              <CsrfField />
              <input type="hidden" name="teamId" value={team.id} />
              <SelectField label="加入既有商家成員" name="vendorMemberId" defaultValue="">
                <option value="">請選擇成員</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>{member.user.name || member.user.email}（{member.user.email}）</option>
                ))}
              </SelectField>
              <SubmitButton>加入團隊</SubmitButton>
            </form>

            <div className="overflow-x-auto rounded-md border border-border">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs text-slate-600">
                  <tr>
                    <th className="px-3 py-2 font-semibold">成員</th>
                    <th className="px-3 py-2 font-semibold">直接上線</th>
                    <th className="px-3 py-2 font-semibold">推廣夥伴（團隊佣金受益人）</th>
                    <th className="px-3 py-2 font-semibold">狀態</th>
                    <th className="px-3 py-2 font-semibold">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {team.memberships.map((membership) => {
                    const currentUpline = membership.uplineRelationships[0]?.uplineMembershipId ?? "";
                    const boundAffiliate = membership.affiliate;
                    const emailMatches = boundAffiliate ? [] : unboundAffiliatesByEmail.get(normalizedEmail(membership.vendorMember.user.email) ?? "") ?? [];
                    return (
                      <tr key={membership.id}>
                        <td className="px-3 py-3 align-top">
                          <p className="font-medium text-slate-900">{membership.vendorMember.user.name || membership.vendorMember.user.email}</p>
                          <p className="text-xs text-slate-500">{membership.vendorMember.user.email}</p>
                        </td>
                        <td className="px-3 py-3 align-top">
                          <form action={setTeamUplineAction} className="flex min-w-[15rem] gap-2">
                            <CsrfField />
                            <input type="hidden" name="teamId" value={team.id} />
                            <input type="hidden" name="downlineMembershipId" value={membership.id} />
                            <select key={`${membership.id}:${currentUpline}`} name="uplineMembershipId" defaultValue={currentUpline} className="h-10 min-w-0 flex-1 rounded-md border border-border-control bg-white px-2 text-sm">
                              <option value="">（無直接上線）</option>
                              {team.memberships.filter((candidate) => candidate.id !== membership.id).map((candidate) => (
                                <option key={candidate.id} value={candidate.id}>{candidate.vendorMember.user.name || candidate.vendorMember.user.email}</option>
                              ))}
                            </select>
                            <SubmitButton pendingChildren="儲存中…">儲存</SubmitButton>
                          </form>
                        </td>
                        <td className="px-3 py-3 align-top">
                          <div className="grid min-w-[16rem] gap-2">
                            {boundAffiliate ? (
                              <p className="text-xs text-slate-600">
                                目前綁定：<span className="font-medium text-slate-900">{boundAffiliate.name}</span>
                                <span className="ml-1 font-mono">（{boundAffiliate.code}）</span>
                                {boundAffiliate.isActive ? null : <span className="ml-1 text-red-700">已停用</span>}
                              </p>
                            ) : <p className="text-xs text-slate-500">尚未綁定，這位成員擔任上線時不會收到團隊佣金。</p>}
                            {boundAffiliate && !boundAffiliate.isActive ? (
                              <p role="note" className="rounded-md bg-red-50 px-2 py-1 text-xs text-red-700">此推廣夥伴已停用，該層上線佣金不會發放。</p>
                            ) : null}
                            <form action={setTeamMembershipAffiliateAction} className="flex gap-2">
                              <CsrfField />
                              <input type="hidden" name="membershipId" value={membership.id} />
                              <select key={`${membership.id}:${boundAffiliate?.id ?? ""}`} name="affiliateId" defaultValue={boundAffiliate?.id ?? ""} aria-label={`${membership.vendorMember.user.name || membership.vendorMember.user.email} 的推廣夥伴`} className="h-10 min-w-0 flex-1 rounded-md border border-border-control bg-white px-2 text-sm">
                                <option value="">（不綁定）</option>
                                {boundAffiliate && !boundAffiliate.isActive ? <option value={boundAffiliate.id}>{boundAffiliate.name}（{boundAffiliate.code}，已停用）</option> : null}
                                {affiliates.map((affiliate) => {
                                  const holder = affiliateHolder.get(affiliate.id);
                                  const takenByOther = Boolean(holder && holder.id !== membership.id);
                                  return (
                                    <option key={affiliate.id} value={affiliate.id} disabled={takenByOther}>
                                      {affiliate.name}（{affiliate.code}）{takenByOther ? (holder!.inactive ? "・綁定在已停用的成員紀錄上" : "・已綁定其他成員") : ""}
                                    </option>
                                  );
                                })}
                              </select>
                              <SubmitButton pendingChildren="儲存中…">儲存</SubmitButton>
                            </form>
                            {emailMatches.length === 1 ? (
                              <form action={setTeamMembershipAffiliateAction} className="flex flex-wrap items-center gap-2 rounded-md bg-amber-50 px-2 py-2 text-xs text-amber-800">
                                <CsrfField />
                                <input type="hidden" name="membershipId" value={membership.id} />
                                <input type="hidden" name="affiliateId" value={emailMatches[0]!.id} />
                                <span>推廣夥伴「{emailMatches[0]!.name}」（{emailMatches[0]!.code}）的聯絡 Email 與這位成員相同（依推廣夥伴的聯絡 Email 比對，未驗證）。</span>
                                <SubmitButton pendingChildren="綁定中…">一鍵綁定</SubmitButton>
                              </form>
                            ) : emailMatches.length > 1 ? (
                              <p className="rounded-md bg-amber-50 px-2 py-2 text-xs text-amber-800">有 {emailMatches.length} 位未綁定的推廣夥伴使用與這位成員相同的 Email（依推廣夥伴的聯絡 Email 比對，未驗證），請從選單確認後再綁定。</p>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-3 py-3 align-top"><Badge tone="green">ACTIVE</Badge></td>
                        <td className="px-3 py-3 align-top">
                          <div className="grid gap-2">
                            {teams.filter((candidate) => candidate.id !== team.id).length > 0 ? (
                              <form action={transferTeamMemberAction} className="grid gap-2">
                                <CsrfField />
                                <input type="hidden" name="sourceTeamId" value={team.id} />
                                <input type="hidden" name="membershipId" value={membership.id} />
                                <label className="text-xs font-medium text-slate-600">
                                  轉移到
                                  <select name="targetTeamId" defaultValue="" className="mt-1 h-9 w-full rounded-md border border-border-control bg-white px-2 text-xs" required>
                                    <option value="">請選擇目標團隊</option>
                                    {teams.filter((candidate) => candidate.id !== team.id).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
                                  </select>
                                </label>
                                <SubmitButton pendingChildren="轉移中…">轉移成員</SubmitButton>
                              </form>
                            ) : null}
                            {membership.vendorMemberId === auth.member.id ? <span className="text-xs text-slate-500">目前登入者</span> : (
                              <form action={deactivateTeamMembershipAction} className="grid gap-2">
                                <CsrfField />
                                <input type="hidden" name="teamId" value={team.id} />
                                <input type="hidden" name="membershipId" value={membership.id} />
                                <DangerButton>停用</DangerButton>
                              </form>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        ))}
      </div>

      {inactiveBindings.length > 0 ? (
        <Card className="mt-5">
          <h2 className="mb-1 text-lg font-semibold text-slate-950">已停用成員紀錄上的綁定</h2>
          <p className="mb-4 text-sm text-slate-600">這些推廣夥伴綁定在已停用的成員紀錄上，不會發放團隊上線佣金，也無法改綁給其他成員。解除後即可重新綁定。</p>
          <ul className="grid gap-2">
            {inactiveBindings.map((bound) => (
              <li key={bound.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm">
                <span>
                  <span className="font-medium text-slate-900">{bound.affiliate?.name}</span>
                  <span className="ml-1 font-mono text-xs text-slate-600">（{bound.affiliate?.code}）</span>
                  <span className="ml-2 text-xs text-slate-500">綁定在已停用的成員紀錄上：{bound.vendorMember.user.name || bound.vendorMember.user.email}・{bound.team.name}</span>
                </span>
                <form action={setTeamMembershipAffiliateAction}>
                  <CsrfField />
                  <input type="hidden" name="membershipId" value={bound.id} />
                  <input type="hidden" name="affiliateId" value="" />
                  <DangerButton>解除綁定</DangerButton>
                </form>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </>
  );
}
