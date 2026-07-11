import { redirect } from "next/navigation";
import { ProductForm } from "@/components/product-form";
import { PageHeader } from "@/components/ui";
import { requireAuth } from "@/lib/auth";
import { canManageCommerceProducts } from "@/lib/vendor-capabilities";

export default async function NewProductPage() {
  const auth = await requireAuth();
  if (!auth.vendor || !canManageCommerceProducts(auth.member?.role)) redirect("/products?error=commerce_manager_required");
  return (
    <>
      <PageHeader title="新增商品" description="建立可綁定到直播間的商品卡與 CTA。" />
      <ProductForm />
    </>
  );
}
