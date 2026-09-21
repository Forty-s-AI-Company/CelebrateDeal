"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireVendorManagerContext } from "@/lib/auth";
import { assertServerActionSecurity } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import { issueManualCustomerVoucher } from "@/lib/customer-voucher";
import { revealCommerceOrderPii } from "@/lib/commerce-order-pii";
import { automationCustomerKeyHash } from "@/lib/automation-workflow";
import { requireEditableSalesProjectScope } from "@/lib/sales-project-scope";

const Hash = z.string().min(32).max(128).regex(/^[A-Za-z0-9_-]+$/u);

function value(formData: FormData, key: string) {
  const item = formData.get(key);
  return typeof item === "string" ? item.trim() : "";
}

function refresh(hash: string) {
  revalidatePath(`/customers/${encodeURIComponent(hash)}`);
}

/**
 * Issues a short-lived manual voucher only inside the selected sales project.
 * The caller transaction persists the grant and encrypted email atomically.
 */
export async function grantCustomerVoucherAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { auth, vendor } = await requireVendorManagerContext();
  const customerKeyHash = Hash.parse(value(formData, "customerKeyHash"));
  const productId = z.string().min(1).max(191).parse(value(formData, "productId"));
  const scope = await requireEditableSalesProjectScope(auth.user.id, vendor.id);
  const db = getDb();

  if (scope.projectId) {
    const membership = await db.salesProjectCustomer.findUnique({
      where: { vendorId_projectId_customerKeyHash: { vendorId: vendor.id, projectId: scope.projectId, customerKeyHash } },
      select: { id: true },
    });
    if (!membership) throw new Error("customer_not_in_selected_project");
  }

  const product = await db.product.findFirst({
    where: {
      id: productId,
      vendorId: vendor.id,
      isActive: true,
      ...(scope.projectId ? { salesProjectLinks: { some: { vendorId: vendor.id, projectId: scope.projectId } } } : {}),
    },
    select: { id: true, name: true, currency: true },
  });
  if (!product) throw new Error("找不到可派券的商品");

  const projectForm = scope.projectId ? { projectId: scope.projectId } : {};
  const projectEvent = scope.projectId ? { projectId: scope.projectId } : {};
  const [verifiedSubmissions, bookings] = await Promise.all([
    db.formSubmission.findMany({ where: { form: { vendorId: vendor.id, ...projectForm }, verificationStatus: "VERIFIED" }, select: { email: true }, orderBy: { createdAt: "desc" } }),
    db.consultationBooking.findMany({ where: { vendorId: vendor.id, event: projectEvent }, select: { clientEmail: true }, orderBy: { createdAt: "desc" } }),
  ]);
  let recipientEmail = verifiedSubmissions.find((row) => automationCustomerKeyHash(vendor.id, row.email) === customerKeyHash)?.email
    ?? bookings.find((row) => automationCustomerKeyHash(vendor.id, row.clientEmail) === customerKeyHash)?.clientEmail;

  if (!recipientEmail) {
    const order = await db.commerceOrder.findFirst({
      where: { vendorId: vendor.id, automationCustomerKeyHash: customerKeyHash, ...(scope.projectId ? { projectId: scope.projectId } : {}) },
      select: { id: true, buyerEncryptedEnvelope: true, shippingEncryptedEnvelope: true }, orderBy: { createdAt: "desc" },
    });
    if (order) recipientEmail = revealCommerceOrderPii({ buyerEncrypted: order.buyerEncryptedEnvelope, shippingEncrypted: order.shippingEncryptedEnvelope }, { vendorId: vendor.id, orderId: order.id }).buyer.email;
  }

  if (!recipientEmail) throw new Error("找不到已驗證的學員聯絡方式");

  await db.$transaction(async (transaction) => issueManualCustomerVoucher({ db: transaction, vendorId: vendor.id, customerKeyHash, product, recipientEmail }));
  refresh(customerKeyHash);
}
