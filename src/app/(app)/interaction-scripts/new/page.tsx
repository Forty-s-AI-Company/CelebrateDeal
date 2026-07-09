import { InteractionScriptForm } from "@/components/interaction-script-form";
import { PageHeader } from "@/components/ui";
import { requireVendor } from "@/lib/auth";
import { getDb } from "@/lib/db";

export default async function NewInteractionScriptPage() {
  const vendor = await requireVendor();
  const [roles, products] = await Promise.all([
    getDb().interactionRole.findMany({ where: { vendorId: vendor.id, isActive: true } }),
    getDb().product.findMany({ where: { vendorId: vendor.id, isActive: true } }),
  ]);
  return (
    <>
      <PageHeader title="新增互動腳本" description="以秒數時間軸編排官方互動、商品浮出與 CTA 節奏。" />
      <InteractionScriptForm roles={roles} products={products} />
    </>
  );
}
