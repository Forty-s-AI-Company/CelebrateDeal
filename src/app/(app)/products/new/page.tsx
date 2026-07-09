import { ProductForm } from "@/components/product-form";
import { PageHeader } from "@/components/ui";

export default function NewProductPage() {
  return (
    <>
      <PageHeader title="新增商品" description="建立可綁定到直播間的商品卡與 CTA。" />
      <ProductForm />
    </>
  );
}
