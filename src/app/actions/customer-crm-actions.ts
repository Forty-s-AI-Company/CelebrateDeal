"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireVendorManagerContext } from "@/lib/auth";
import { assertServerActionSecurity } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import { issueManualCustomerVoucher } from "@/lib/customer-voucher";
import { revealCommerceOrderPii } from "@/lib/commerce-order-pii";
import { automationCustomerKeyHash } from "@/lib/automation-workflow";
import { listCustomers, type CustomerListItem } from "@/lib/customer-crm";

const Hash = z.string().min(32).max(128).regex(/^[A-Za-z0-9_-]+$/u);
const Status = z.enum(["following_up", "closed_won", "closed_lost", "no_show"]);
const Tag = z.string().trim().min(1).max(50);

function value(formData: FormData, key: string) {
  const item = formData.get(key);
  return typeof item === "string" ? item.trim() : "";
}

function refresh(hash: string) {
  revalidatePath("/customers");
  revalidatePath(`/customers/${encodeURIComponent(hash)}`);
}

/** Adds an append-only note and updates the tenant-owned CRM record atomically. */
export async function saveConsultantNoteAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { auth, vendor } = await requireVendorManagerContext();
  const customerKeyHash = Hash.parse(value(formData, "customerKeyHash"));
  const body = z.string().trim().min(1).max(4_000).parse(value(formData, "body"));
  const status = Status.parse(value(formData, "status"));
  await getDb().$transaction(async (transaction) => {
    const record = await transaction.customerCrmRecord.upsert({
      where: { vendorId_customerKeyHash: { vendorId: vendor.id, customerKeyHash } },
      create: { vendorId: vendor.id, customerKeyHash, consultationStatus: status },
      update: { consultationStatus: status },
    });
    await transaction.consultantNote.create({ data: { vendorId: vendor.id, customerRecordId: record.id, body, actorId: auth.member!.id, actorLabel: auth.member!.role } });
  });
  refresh(customerKeyHash);
}

export async function updateCustomerStatusAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { vendor } = await requireVendorManagerContext();
  const customerKeyHash = Hash.parse(value(formData, "customerKeyHash"));
  const consultationStatus = Status.parse(value(formData, "status"));
  await getDb().customerCrmRecord.upsert({ where: { vendorId_customerKeyHash: { vendorId: vendor.id, customerKeyHash } }, create: { vendorId: vendor.id, customerKeyHash, consultationStatus }, update: { consultationStatus } });
  refresh(customerKeyHash);
}

export async function addCustomerTagAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { vendor } = await requireVendorManagerContext();
  const customerKeyHash = Hash.parse(value(formData, "customerKeyHash"));
  const tag = Tag.parse(value(formData, "tag")).toLocaleLowerCase("zh-TW");
  await getDb().customerTagAssignment.upsert({ where: { vendorId_customerKeyHash_tag: { vendorId: vendor.id, customerKeyHash, tag } }, create: { vendorId: vendor.id, customerKeyHash, tag }, update: {} });
  refresh(customerKeyHash);
}

export async function removeCustomerTagAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { vendor } = await requireVendorManagerContext();
  const customerKeyHash = Hash.parse(value(formData, "customerKeyHash"));
  const tag = Tag.parse(value(formData, "tag")).toLocaleLowerCase("zh-TW");
  await getDb().customerTagAssignment.deleteMany({ where: { vendorId: vendor.id, customerKeyHash, tag } });
  refresh(customerKeyHash);
}

/** Issues a short-lived manual voucher through the canonical hashed bearer contract. */
export async function grantCustomerVoucherAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { vendor } = await requireVendorManagerContext();
  const customerKeyHash = Hash.parse(value(formData, "customerKeyHash"));
  const productId = z.string().min(1).max(191).parse(value(formData, "productId"));
  const product = await getDb().product.findFirst({ where: { id: productId, vendorId: vendor.id, isActive: true }, select: { id: true, name: true, currency: true } });
  if (!product) throw new Error("找不到可派券的商品");
  const identity = await getDb().formSubmission.findFirst({ where: { customerKeyHash, form: { vendorId: vendor.id }, verificationStatus: "VERIFIED" }, select: { email: true }, orderBy: { createdAt: "desc" } })
    ?? await getDb().consultationBooking.findFirst({ where: { vendorId: vendor.id, customerKeyHash }, select: { clientEmail: true }, orderBy: { createdAt: "desc" } });
  let recipientEmail = identity && "email" in identity ? identity.email : identity?.clientEmail;
  if (!recipientEmail) {
    const order = await getDb().commerceOrder.findFirst({ where: { vendorId: vendor.id, automationCustomerKeyHash: customerKeyHash }, select: { id: true, buyerEncryptedEnvelope: true, shippingEncryptedEnvelope: true }, orderBy: { createdAt: "desc" } });
    if (order) recipientEmail = revealCommerceOrderPii({ buyerEncrypted: order.buyerEncryptedEnvelope, shippingEncrypted: order.shippingEncryptedEnvelope }, { vendorId: vendor.id, orderId: order.id }).buyer.email;
  }
  if (!recipientEmail) {
    const [legacySubmissions, legacyBookings] = await Promise.all([
      getDb().formSubmission.findMany({ where: { form: { vendorId: vendor.id }, customerKeyHash: null, verificationStatus: "VERIFIED" }, select: { email: true } }),
      getDb().consultationBooking.findMany({ where: { vendorId: vendor.id, customerKeyHash: null }, select: { clientEmail: true } }),
    ]);
    recipientEmail = legacySubmissions.find((row) => automationCustomerKeyHash(vendor.id, row.email) === customerKeyHash)?.email
      ?? legacyBookings.find((row) => automationCustomerKeyHash(vendor.id, row.clientEmail) === customerKeyHash)?.clientEmail;
  }
  if (!recipientEmail) throw new Error("找不到已驗證的學員聯絡方式");
  await getDb().$transaction(async (transaction) => issueManualCustomerVoucher({ db: transaction, vendorId: vendor.id, customerKeyHash, product, recipientEmail }));
  refresh(customerKeyHash);
}

export type CustomerSearchActionState = { status: "idle" | "success" | "error"; message: string; items: CustomerListItem[] };

/** Keeps raw Email/phone search terms in a CSRF-protected POST body, never the URL. */
export async function searchCustomersAction(_previous: CustomerSearchActionState, formData: FormData): Promise<CustomerSearchActionState> {
  try {
    await assertServerActionSecurity(formData);
    const { vendor } = await requireVendorManagerContext();
    const query = z.string().max(320).parse(value(formData, "query"));
    const tag = z.string().max(50).parse(value(formData, "tag")).toLocaleLowerCase("zh-TW");
    const items = await listCustomers(vendor.id, query, tag);
    return { status: "success", message: items.length ? `找到 ${items.length} 位學員。` : "沒有符合條件的學員。", items };
  } catch {
    return { status: "error", message: "搜尋失敗，請重新整理後再試。", items: [] };
  }
}
