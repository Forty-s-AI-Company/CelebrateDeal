import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { verifyPassword } from "@/lib/password";

export const AUTH_COOKIE = "celebrate_vendor_id";

export async function getCurrentVendor() {
  const cookieStore = await cookies();
  const vendorId = cookieStore.get(AUTH_COOKIE)?.value;

  if (!vendorId) {
    return null;
  }

  return getDb().vendor.findUnique({
    where: { id: vendorId },
    include: { tracking: true },
  });
}

export async function requireVendor() {
  const vendor = await getCurrentVendor();
  if (!vendor) {
    redirect("/login");
  }

  return vendor;
}

export async function requireFinanceAdmin() {
  const vendor = await requireVendor();
  const member = await getDb().vendorMember.findFirst({
    where: {
      vendorId: vendor.id,
      role: { in: ["owner", "admin", "accountant"] },
    },
  });

  if (!member) {
    redirect("/dashboard");
  }

  return { vendor, member };
}

export async function authenticateVendor(email: string, password: string) {
  const vendor = await getDb().vendor.findUnique({
    where: { email },
  });

  if (!vendor || !verifyPassword(password, vendor.passwordHash)) {
    return null;
  }

  return vendor;
}
