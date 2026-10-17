"use server";

import { Prisma } from "@prisma/client";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireVendorManagerContext } from "@/lib/auth";
import { assertServerActionSecurity } from "@/lib/csrf";
import { getDb } from "@/lib/db";

/** Managers may select an owner-configured account; credentials stay owner-only. */
export async function selectProjectLineAccountAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { vendor, auth } = await requireVendorManagerContext();
  const projectId = formData.get("projectId");
  const accountId = formData.get("accountId");
  if (typeof projectId !== "string" || !projectId || projectId.length > 128 || typeof accountId !== "string" || accountId.length > 128) redirect("/projects");
  const path = `/projects/${encodeURIComponent(projectId)}`;
  try {
    await getDb().$transaction(async tx => {
      const project = await tx.salesProject.findFirst({where:{id:projectId,vendorId:vendor.id}});
      if (!project) throw new Error("not_found");
      const account = accountId ? await tx.lineOfficialAccount.findFirst({where:{id:accountId,vendorId:vendor.id,status:"active"},select:{id:true}}) : null;
      if (accountId && !account) throw new Error("not_found");
      if (project.lineOfficialAccountId === (account?.id ?? null)) return;
      // Do not change routing while a push through the old account is in flight.
      // Conservatively includes other Projects sharing this account; the existing
      // worker recovers expired leases before switching can be retried.
      if (project.lineOfficialAccountId && await tx.lineDelivery.findFirst({where:{vendorId:vendor.id,lineOfficialAccountId:project.lineOfficialAccountId,status:"sending"},select:{id:true}})) throw new Error("sending");
      await tx.salesProject.update({where:{vendorId_id:{vendorId:vendor.id,id:project.id}},data:{lineOfficialAccountId:account?.id ?? null}});
      await tx.auditLog.create({data:{vendorId:vendor.id,actorId:auth.user.id,action:"select_project_line_account",targetType:"SalesProject",targetId:project.id,before:{lineOfficialAccountId:project.lineOfficialAccountId},after:{lineOfficialAccountId:account?.id ?? null}}});
    },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
  } catch {
    redirect(`${path}?lineError=unavailable`);
  }
  revalidatePath(path);
  redirect(`${path}?lineSaved=1`);
}
