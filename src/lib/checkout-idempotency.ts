const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

type CheckoutKeyStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type CheckoutRecoveryRecord = {
  vendorId: string;
  productId: string;
  idempotencyKey: string;
};

function recoveryStorageKey(pathname: string) {
  return `celebratedeal:checkout-recovery:${encodeURIComponent(pathname)}`;
}

export function readCheckoutRecoveryRecord(storage: Pick<CheckoutKeyStorage, "getItem">, pathname: string) {
  const raw = storage.getItem(recoveryStorageKey(pathname));
  if (!raw || raw.length > 1024) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (
      typeof record.vendorId !== "string" || record.vendorId.length < 1 || record.vendorId.length > 128
      || typeof record.productId !== "string" || record.productId.length < 1 || record.productId.length > 128
      || typeof record.idempotencyKey !== "string" || !UUID_PATTERN.test(record.idempotencyKey)
    ) return null;
    return record as CheckoutRecoveryRecord;
  } catch {
    return null;
  }
}

export function saveCheckoutRecoveryRecord(storage: CheckoutKeyStorage, pathname: string, record: CheckoutRecoveryRecord) {
  if (!UUID_PATTERN.test(record.idempotencyKey)) throw new Error("Invalid checkout recovery key.");
  storage.setItem(recoveryStorageKey(pathname), JSON.stringify(record));
}

export function clearCheckoutRecoveryRecord(storage: CheckoutKeyStorage, pathname: string) {
  storage.removeItem(recoveryStorageKey(pathname));
}

export function checkoutIdempotencyStorageKey(vendorId: string, productId: string) {
  return `celebratedeal:checkout:${encodeURIComponent(vendorId)}:${encodeURIComponent(productId)}`;
}

export function readCheckoutIdempotencyKey(
  storage: Pick<CheckoutKeyStorage, "getItem">,
  vendorId: string,
  productId: string,
) {
  const existing = storage.getItem(checkoutIdempotencyStorageKey(vendorId, productId));
  return existing && UUID_PATTERN.test(existing) ? existing : null;
}

export function getOrCreateCheckoutIdempotencyKey(
  storage: CheckoutKeyStorage,
  vendorId: string,
  productId: string,
  create: () => string,
) {
  const key = checkoutIdempotencyStorageKey(vendorId, productId);
  const existing = readCheckoutIdempotencyKey(storage, vendorId, productId);
  if (existing) return existing;

  const created = create();
  if (!UUID_PATTERN.test(created)) throw new Error("Checkout idempotency key generator returned an invalid value.");
  storage.setItem(key, created);
  return created;
}

export function clearCheckoutIdempotencyKey(
  storage: CheckoutKeyStorage,
  vendorId: string,
  productId: string,
) {
  storage.removeItem(checkoutIdempotencyStorageKey(vendorId, productId));
}
