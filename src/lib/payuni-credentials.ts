/** Selects one complete merchant credential set from the chosen PAYUNi environment. */
export function payUniCredentialKeys(env: Record<string, string | undefined> = process.env) {
  if (env.PAYUNI_ENV === "production") {
    return {
      merchantId: "PAYUNI_PRODUCTION_MERCHANT_ID",
      hashKey: "PAYUNI_PRODUCTION_HASH_KEY",
      hashIv: "PAYUNI_PRODUCTION_HASH_IV",
    } as const;
  }
  if (env.PAYUNI_ENV === "sandbox") {
    // Existing Sandbox deployments may still use the original names. A
    // partially configured dedicated set must never be mixed with them.
    const dedicated = [env.PAYUNI_SANDBOX_MERCHANT_ID, env.PAYUNI_SANDBOX_HASH_KEY, env.PAYUNI_SANDBOX_HASH_IV]
      .some((value) => value !== undefined);
    return dedicated
      ? {
        merchantId: "PAYUNI_SANDBOX_MERCHANT_ID",
        hashKey: "PAYUNI_SANDBOX_HASH_KEY",
        hashIv: "PAYUNI_SANDBOX_HASH_IV",
      } as const
      : {
        merchantId: "PAYUNI_MERCHANT_ID",
        hashKey: "PAYUNI_HASH_KEY",
        hashIv: "PAYUNI_HASH_IV",
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
