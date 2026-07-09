import { notFound } from "next/navigation";
import { ProductForm } from "@/components/product-form";
import { PageHeader } from "@/components/ui";
import { requireVendor } from "@/lib/auth";
import { getDb } from "@/lib/db";

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const vendor = await requireVendor();
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
