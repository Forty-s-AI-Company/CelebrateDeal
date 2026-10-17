import { redirect } from "next/navigation";

export default function CommissionSettingsPage() {
  // Individual partner rates are managed in the existing affiliates workspace.
  // Keep old bookmarks usable; destination guards remain authoritative.
  redirect("/affiliates");
}
