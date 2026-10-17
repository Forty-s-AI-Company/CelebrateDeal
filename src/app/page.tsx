import { redirect } from "next/navigation";
import { getCurrentVendor } from "@/lib/auth";

export default async function HomePage() {
  const vendor = await getCurrentVendor();
  // 先完成身分查詢再送出HTTP轉址，避免載入骨架先串流成200。
  return redirect(vendor ? "/dashboard" : "/login?from=home");
}
