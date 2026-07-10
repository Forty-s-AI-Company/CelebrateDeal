import { createCloudflareStreamWebhookSignature } from "./cloudflare-webhook-signature";

export type CloudflareStreamWebhookFixture =
  | "ready"
  | "processing"
  | "error"
  | "invalid_signature"
  | "expired_timestamp";

type BuildFixtureOptions = {
  fixture: CloudflareStreamWebhookFixture;
  uid?: string;
  secret: string;
  nowSeconds?: number;
};

function basePayload(uid: string) {
  return {
    uid,
    thumbnail: `https://customer-example.cloudflarestream.com/${uid}/thumbnails/thumbnail.jpg`,
    duration: 91.6,
    playback: {
      hls: `https://customer-example.cloudflarestream.com/${uid}/manifest/video.m3u8`,
      dash: `https://customer-example.cloudflarestream.com/${uid}/manifest/video.mpd`,
    },
  };
}

export function buildCloudflareStreamWebhookPayload(fixture: CloudflareStreamWebhookFixture, uid = "cf_fixture_uid") {
  const base = basePayload(uid);

  if (fixture === "processing") {
    return {
      ...base,
      readyToStream: false,
      status: {
        state: "processing",
        pctComplete: "39.000000",
      },
    };
  }

  if (fixture === "error") {
    return {
      ...base,
      readyToStream: false,
      status: {
        state: "error",
        pctComplete: "39.000000",
        errReasonCode: "ERR_MALFORMED_VIDEO",
        errReasonText: "The video was deemed to be corrupted or malformed.",
      },
    };
  }

  return {
    ...base,
    readyToStream: true,
    status: {
      state: "ready",
      pctComplete: "100.000000",
    },
  };
}

export function buildCloudflareStreamWebhookFixture({
  fixture,
  uid = `cf_fixture_${fixture}`,
  secret,
  nowSeconds = Math.floor(Date.now() / 1000),
}: BuildFixtureOptions) {
  const body = JSON.stringify(buildCloudflareStreamWebhookPayload(fixture, uid));
  const timestamp = fixture === "expired_timestamp" ? nowSeconds - 10 * 60 : nowSeconds;
  const signingSecret = fixture === "invalid_signature" ? `${secret}-invalid` : secret;
  const signature = createCloudflareStreamWebhookSignature({
    body,
    secret: signingSecret,
    timestamp,
  });

  return {
    body,
    headers: {
      "Content-Type": "application/json",
      "Webhook-Signature": `time=${timestamp},sig1=${signature}`,
    },
    expectedStatus: fixture === "invalid_signature" || fixture === "expired_timestamp" ? 401 : 200,
  };
}
