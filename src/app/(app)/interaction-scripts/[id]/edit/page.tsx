import { notFound } from "next/navigation";
import { InteractionScriptForm } from "@/components/interaction-script-form";
import { PageHeader } from "@/components/ui";
import { requireVendorManager } from "@/lib/auth";
import { getCsrfToken } from "@/lib/csrf";
import { getDb } from "@/lib/db";

export default async function EditInteractionScriptPage({ params }: { params: Promise<{ id: string }> }) {
  const vendor = await requireVendorManager();
  const { id } = await params;
  const db = getDb();
  const [script, roles, products, csrfToken] = await Promise.all([
    db.interactionScript.findFirst({ where: { id, vendorId: vendor.id }, include: { events: { orderBy: { triggerSec: "asc" } }, lives: { include: { video: true } } } }),
    db.interactionRole.findMany({ where: { vendorId: vendor.id, isActive: true } }),
    db.product.findMany({ where: { vendorId: vendor.id, isActive: true } }),
    getCsrfToken(),
  ]);
  if (!script) notFound();
  return (
    <>
      <PageHeader title="編輯互動腳本" description="調整時間軸事件，讓前台依影片進度觸發官方互動。" />
      <InteractionScriptForm script={script} roles={roles} products={products} boundLives={script.lives} csrfToken={csrfToken} />
    </>
  );
}
