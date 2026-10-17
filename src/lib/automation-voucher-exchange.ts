import { createHmac } from "node:crypto";
import { deriveSensitiveDataKey } from "@/lib/sensitive-data";
import type { PrismaClient } from "@prisma/client";
import { hashInteractionBearer } from "@/lib/live-interaction";

type VoucherDatabase = Pick<PrismaClient, "automationVoucherGrant">;
export const AUTOMATION_VOUCHER_BEARER = /^[A-Za-z0-9_-]{43}$/u;

/** 預覽保留原兌換資格，完全不寫入或建立 checkout 憑證。 */
export async function previewAutomationVoucher(database: VoucherDatabase, capability: string, now = new Date()) {
  if (!AUTOMATION_VOUCHER_BEARER.test(capability)) return null;
  const grant = await database.automationVoucherGrant.findUnique({
    where: { claimTokenHash: hashInteractionBearer(capability) },
    select: { id: true, vendorId: true, productId: true, expiresAt: true, usedOrderId: true, vendor: { select: { name: true } } },
  });
  return grant && !grant.usedOrderId && grant.expiresAt > now ? grant : null;
}

type Confirmation = { nonce: string; issued: string };
/** 同一確認可安全重送；不同 challenge 仍只能有一個原子交換成功。 */
export async function exchangeAutomationVoucher(database: VoucherDatabase, capability: string, confirmation: Confirmation, now = new Date()) {
  if (!AUTOMATION_VOUCHER_BEARER.test(capability) || !AUTOMATION_VOUCHER_BEARER.test(confirmation.nonce) || !/^\d{13}$/u.test(confirmation.issued)) return null;
  const age = now.getTime() - Number(confirmation.issued);
  if (age < 0 || age >= 300_000) return null;
  // 原始 link hash 唯一且不可猜；HMAC 讓同一 browser challenge 的遺失回應可重建。
  const oldHash = hashInteractionBearer(capability);
  const bearer = createHmac("sha256", deriveSensitiveDataKey("automation-voucher-exchange-v1"))
    .update(JSON.stringify([oldHash, confirmation.nonce, confirmation.issued])).digest("base64url");
  const retry = async () => {
    const grant = await previewAutomationVoucher(database, bearer, now);
    return grant ? { bearer, vendorId: grant.vendorId, productId: grant.productId, expiresAt: grant.expiresAt, exchanged: false } : null;
  };
  const grant = await previewAutomationVoucher(database, capability, now);
  if (!grant) return retry();
  const exchanged = await database.automationVoucherGrant.updateMany({
    where: { id: grant.id, vendorId: grant.vendorId, productId: grant.productId, claimTokenHash: oldHash, usedOrderId: null, expiresAt: { gt: now } },
    data: { claimTokenHash: hashInteractionBearer(bearer) },
  });
  if (exchanged.count !== 1) return retry();
  // 不設定 usedOrderId/redeemedAt，不建立訂單；原 checkout 仍驗證金額及商品資格。
  return { bearer, vendorId: grant.vendorId, productId: grant.productId, expiresAt: grant.expiresAt, exchanged: true };
}
