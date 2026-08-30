const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

type CheckoutKeyStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

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
