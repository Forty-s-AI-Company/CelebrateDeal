function hasValue(value: string | undefined) {
  return Boolean(value && value.trim() && !value.includes("...") && !value.includes("example"));
}

function tokenShape(value: string | undefined) {
  if (!hasValue(value)) {
    return "missing";
  }
  return `present:${value!.length}chars`;
}

export function getCloudflareStreamDiagnostics(env: NodeJS.ProcessEnv = process.env) {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  const token = env.CLOUDFLARE_STREAM_TOKEN;
  const webhookSecret = env.CLOUDFLARE_STREAM_WEBHOOK_SECRET;
  const apiBase = "https://api.cloudflare.com/client/v4";
  const accountBasePath = `/accounts/${accountId ? "<configured-account-id>" : "<missing-account-id>"}`;

  return {
    ok: hasValue(accountId) && hasValue(token) && hasValue(webhookSecret),
    apiBase,
    accountId: {
      configured: hasValue(accountId),
      length: accountId?.length ?? 0,
    },
    streamToken: {
      configured: hasValue(token),
      shape: tokenShape(token),
    },
    webhookSecret: {
      configured: hasValue(webhookSecret),
      shape: tokenShape(webhookSecret),
      officialHeader: "Webhook-Signature",
      fallbackHeader: "x-cloudflare-stream-webhook-secret",
    },
    webhookModes: [
      {
        id: "official-signature",
        configured: hasValue(webhookSecret),
        header: "Webhook-Signature",
        description: "Cloudflare Stream VOD official HMAC-SHA256 signature verification.",
      },
      {
        id: "shared-secret-fallback",
        configured: hasValue(webhookSecret),
        header: "x-cloudflare-stream-webhook-secret",
        description: "Staging / local smoke fallback. Keep only as an operational fallback.",
      },
    ],
    endpoints: [
      `${apiBase}${accountBasePath}/stream/direct_upload`,
      `${apiBase}${accountBasePath}/stream/live_inputs`,
      `${apiBase}${accountBasePath}/stream/<uid>`,
    ],
    likelyAuthenticationErrorCauses: [
      "CLOUDFLARE_ACCOUNT_ID 不是目前 Stream 所在帳號。",
      "CLOUDFLARE_STREAM_TOKEN 不屬於該帳號，或 token 已撤銷 / 過期。",
      "API token 沒有 Account -> Stream -> Edit 權限，因此不能建立 direct upload 或 Live Input。",
      "Cloudflare dashboard 選到錯誤 account，導致 token resource scope include 到另一個帳號。",
      "環境變數在 Vercel staging / production 未重新部署，runtime 還在使用舊 token。",
    ],
  };
}
