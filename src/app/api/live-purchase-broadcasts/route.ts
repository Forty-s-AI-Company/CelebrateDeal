import { requireSameOriginRequest } from "@/lib/api-security";
import { getDb } from "@/lib/db";
import { liveViewerTokenFromRequest } from "@/lib/live-quota-admission";
import { LivePurchaseBroadcastAccessDenied, LivePurchaseBroadcastQuery, listLivePurchaseBroadcasts } from "@/lib/live-purchase-broadcasts";
import { checkRateLimit } from "@/lib/rate-limit";
import { liveChatIpTrustConfig, rateLimitRequestWithIdentity } from "@/lib/live-chat-request-security";
import { getRequestClientIp } from "@/lib/request-client-ip";

const headers = { "Cache-Control": "private, no-store", "CDN-Cache-Control": "no-store", "Vary": "Cookie", "X-Content-Type-Options": "nosniff" };
const json = (data: unknown, status = 200) => Response.json(data, { status, headers });
const noStore = (response: Response) => { for (const [name, value] of Object.entries(headers)) response.headers.set(name, value); return response; };

export async function GET(request: Request) {
  const originError = requireSameOriginRequest(request, { requireClientHeader: true });
  if (originError) return noStore(originError);
  if (request.url.length > 2048) return json({ error: "Invalid broadcast scope" }, 400);
  const query = new URL(request.url).searchParams;
  if ([...query.keys()].some(key => query.getAll(key).length !== 1)) return json({ error: "Invalid broadcast scope" }, 400);
  const parsed = LivePurchaseBroadcastQuery.safeParse(Object.fromEntries(query));
  if (!parsed.success) return json({ error: "Invalid broadcast scope" }, 400);
  const token = liveViewerTokenFromRequest(request);
  if (!token) return json({ error: "Viewer admission required" }, 401);
  const trustedIp = getRequestClientIp(request, liveChatIpTrustConfig());
  const limited = await checkRateLimit(rateLimitRequestWithIdentity(request, trustedIp), "live-purchase-broadcasts", 120, 60_000);
  if (limited) return noStore(limited);
  try {
    return json({ broadcasts: await listLivePurchaseBroadcasts(getDb(), { ...parsed.data, admissionToken: token }) });
  } catch (error) {
    if (error instanceof LivePurchaseBroadcastAccessDenied) return json({ error: "Viewer admission required" }, 401);
    throw error;
  }
}
