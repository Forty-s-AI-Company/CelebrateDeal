/** Map a database-clock response to browser monotonic time. Response transit
 * is unknowable: offsets deliberately use its lower bound, never a guessed
 * midpoint or Date.now(). The full round-trip is an explicit uncertainty bound.
 */
export function createMetricClock(
  receipt: { anchorAtMs: number; serverNowAtMs: number; expiresAtMs: number; lastElapsedMs: number },
  sentAt: number, receivedAt: number, monotonicNow: () => number,
) {
  const values = [receipt.anchorAtMs, receipt.serverNowAtMs, receipt.expiresAtMs, receipt.lastElapsedMs];
  if (values.some((v) => !Number.isSafeInteger(v) || v < 0)
    || !Number.isFinite(sentAt) || !Number.isFinite(receivedAt) || sentAt < 0 || receivedAt < sentAt
    || receipt.serverNowAtMs < receipt.anchorAtMs || receipt.expiresAtMs <= receipt.serverNowAtMs) return null;
  const uncertaintyMs = Math.ceil(receivedAt - sentAt);
  const base = receipt.serverNowAtMs - receipt.anchorAtMs;
  if (base < receipt.lastElapsedMs) return null;
  let last = receivedAt;
  let invalid = false;
  let expiresAtMs = receipt.expiresAtMs;
  function elapsedMs() {
      const now = monotonicNow();
      if (invalid || !Number.isFinite(now) || now < last) { invalid = true; return NaN; }
      last = now;
      const elapsed = Math.floor(base + now - receivedAt);
      // Stop at the earliest possible expiry, allowing for the full transit
      // uncertainty. A suspended page cannot continue past the session lease.
      if (receipt.anchorAtMs + elapsed + uncertaintyMs >= expiresAtMs || elapsed > 2_147_483_647) return NaN;
      return elapsed;
  }
  return {
    uncertaintyMs,
    elapsedMs,
    remainingMs() {
      const elapsed = elapsedMs();
      return Number.isFinite(elapsed) ? Math.max(0, expiresAtMs - receipt.anchorAtMs - elapsed - uncertaintyMs) : 0;
    },
    // A server-acknowledged extension changes only the bound. Keep the original
    // monotonic mapping, anchor and transit uncertainty; never rebase progress.
    extendExpiry(value: number) {
      if (invalid || !Number.isSafeInteger(value) || value < expiresAtMs) return false;
      expiresAtMs = value;
      return true;
    },
  };
}
