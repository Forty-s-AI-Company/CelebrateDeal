import { redirect } from "next/navigation";
import { getCurrentVendor } from "@/lib/auth";

export default async function HomePage() {
  const vendor = await getCurrentVendor();
  redirect(vendor ? "/dashboard" : "/login");
}
