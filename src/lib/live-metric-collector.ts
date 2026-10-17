import { bindMetricMedia } from "./live-metric-media";
import { createMetricClock } from "./live-metric-clock";
import { createMetricDelivery } from "./live-metric-delivery";
import type { createMetricHttpTransport } from "./live-metric-transport";

type Http = ReturnType<typeof createMetricHttpTransport>;
type Media = Parameters<typeof bindMetricMedia>[0];

/** Own one content/mode session. No credential access, navigation, or media
 * controls. The UI owns scheduling and calls finish before admission release.
 * Request ID is stable across issuance retries, preventing duplicate sessions.
 */
export function createMetricCollector(http: Http, requestId: string, media: Media, now: () => number) {
  let delivery: ReturnType<typeof createMetricDelivery> | null = null;
  let detach: (() => void) | null = null;
  let opening: Promise<void> | null = null;
  let stopped = false;
  let disabled = false;
  let uncertaintyMs: number | null = null;
  let clock: ReturnType<typeof createMetricClock> = null;
  let session: Awaited<ReturnType<Http["open"]>> = null;
  let renewing: Promise<void> | null = null;
  let abandoned = false;

  async function open() {
    try {
      const sent = now();
      const receipt = await http.open(requestId);
      const received = now();
      if (!receipt) { disabled = true; return; }
      // A collector never resumes evidence owned by a previous browser writer.
      // Retry after a lost issuance reply is safe only before any append.
      if (receipt.lastSequence !== -1 || receipt.lastElapsedMs !== 0) { disabled = true; return; }
      clock = createMetricClock(receipt, sent, received, now);
      if (!clock) { disabled = true; return; }
      session = receipt;
      uncertaintyMs = clock.uncertaintyMs;
      delivery = createMetricDelivery(http.session(receipt.sessionId));
      if (abandoned) { await delivery.abandon(); return; }
      if (stopped) { await delivery.finish(); return; }
      detach = bindMetricMedia(media, delivery, clock.elapsedMs);
    } catch {
      // A transient failure leaves issuance retryable with the same request ID.
    }
  }

  async function renew() {
    try {
      const receipt = await http.open(requestId);
      // A media-ended event may seal delivery while the bounded request waits.
      if (delivery?.state().sealed) return;
      if (!receipt || !session || receipt.sessionId !== session.sessionId || receipt.versionId !== session.versionId
        || receipt.anchorAtMs !== session.anchorAtMs || receipt.durationMs !== session.durationMs
        || !clock?.extendExpiry(receipt.expiresAtMs)) {
        disabled = true; detach?.(); detach = null;
        await delivery?.abandon();
      }
    } catch {
      // Retry only this same nonce. The existing clock still stops sampling at
      // the old conservative expiry; a failed request never grants more time.
      if (delivery?.state().sealed) return;
      if (clock?.remainingMs() === 0) {
        disabled = true; detach?.(); detach = null;
        await delivery?.abandon();
      }
    }
  }

  async function tick() {
    if (stopped || disabled) return;
    if (!delivery) {
      opening ??= open().finally(() => { opening = null; });
      await opening;
    } else {
      if (!delivery.state().sealed && clock && clock.remainingMs() <= 30000) {
        renewing ??= renew().finally(() => { renewing = null; });
        await renewing;
      }
      await delivery.flush();
    }
  }

  async function finish() {
    stopped = true;
    detach?.(); detach = null;
    // Issuance already in flight may still create a session. Wait for its
    // bounded transport completion so it can be closed before access release.
    if (opening) await opening;
    if (renewing) await renewing;
    await delivery?.finish();
  }
  async function abandon() {
    abandoned = true; stopped = true; disabled = true;
    detach?.(); detach = null;
    const losing = delivery?.abandon();
    if (opening) await opening;
    if (renewing) await renewing;
    await losing;
    await delivery?.abandon();
  }

  return { tick, finish, abandon, state() { return { stopped, disabled, uncertaintyMs, delivery: delivery?.state() ?? null }; } };
}
