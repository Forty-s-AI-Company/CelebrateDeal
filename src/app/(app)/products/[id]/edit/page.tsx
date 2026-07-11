import { notFound, redirect } from "next/navigation";
import { ProductForm } from "@/components/product-form";
import { PageHeader } from "@/components/ui";
import { requireAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { canManageCommerceProducts } from "@/lib/vendor-capabilities";

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!auth.vendor || !canManageCommerceProducts(auth.member?.role)) redirect("/products?error=commerce_manager_required");
  const vendor = auth.vendor;
  const { id } = await params;
  const product = await getDb().product.findFirst({ where: { id, vendorId: vendor.id } });
  if (!product) notFound();
  return (
    <>
      <PageHeader title="編輯商品" description="調整價格、庫存、圖片與結帳連結。" />
      <ProductForm product={product} />
    </>
  );
}
