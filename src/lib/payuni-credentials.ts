/** Selects one complete merchant credential set from the chosen PAYUNi environment. */
export function payUniCredentialKeys(env: Record<string, string | undefined> = process.env) {
  if (env.PAYUNI_ENV === "production") {
    return {
      merchantId: "PAYUNI_MERCHANT_ID",
      hashKey: "PAYUNI_HASH_KEY",
      hashIv: "PAYUNI_HASH_IV",
    } as const;
  }
  if (env.PAYUNI_ENV === "sandbox") {
    return {
      merchantId: "PAYUNI_SANDBOX_MERCHANT_ID",
      hashKey: "PAYUNI_SANDBOX_HASH_KEY",
      hashIv: "PAYUNI_SANDBOX_HASH_IV",
    } as const;
  }
  throw new Error("PAYUNI_ENV must be sandbox or production.");
}

export function activePayUniCredentials(env: Record<string, string | undefined> = process.env) {
  const keys = payUniCredentialKeys(env);
  const merchantId = env[keys.merchantId]?.trim();
  const key = env[keys.hashKey]?.trim();
  const iv = env[keys.hashIv]?.trim();
  if (!merchantId || !key || !iv || Buffer.byteLength(key) !== 32 || Buffer.byteLength(iv) !== 16) {
    throw new Error("Selected PAYUNi merchant credentials are missing or invalid.");
  }
  return { merchantId, key, iv };
}
