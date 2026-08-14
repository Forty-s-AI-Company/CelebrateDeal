import { createCloudflareStreamWebhookHandler } from "@/lib/cloudflare-stream-webhook-handler";

// Route modules may only export supported Next.js route fields. Keep the
// injectable factory in lib so production type generation remains valid.
export const POST = createCloudflareStreamWebhookHandler();
