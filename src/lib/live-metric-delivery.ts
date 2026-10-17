import { playbackSegment, type PlaybackSample } from "./live-viewing-evidence";

export type DeliverySegment = Readonly<{
  sequence: number; startElapsedMs: number; endElapsedMs: number;
  mediaStartMs: number; mediaEndMs: number; rate: number;
}>;
export type DeliveryReply = { ok: true; lastSequence: number } | { ok: false; retryable: boolean };
export type MetricDeliveryTransport = {
  append: (segments: readonly DeliverySegment[]) => Promise<DeliveryReply>;
  close: (finalSequence: number) => Promise<{ terminal: boolean }>;
};

/** One session, one writer. Network failures retain exact payloads; callers
 * schedule retries. No timers, credentials, storage or playback controls here.
 * At the memory bound collection stops without renumbering retained rows.
 * The missed next segment makes collection incomplete: drain the retained
 * prefix, but leave the server session open instead of certifying its closure.
 */
export function createMetricDelivery(transport: MetricDeliveryTransport, capacity = 200) {
  if (!Number.isInteger(capacity) || capacity < 20 || capacity > 1000) throw new Error("Invalid queue capacity");
  const queue: DeliverySegment[] = [];
  let previous: PlaybackSample | null = null;
  let sequence = 0;
  let sealed = false;
  let terminal = false;
  let rejected = false;
  let capacityReached = false;
  let collectionLost = false;
  let pending: Promise<void> | null = null;

  function sample(current: PlaybackSample) {
    if (sealed || rejected || terminal) return;
    const segment = playbackSegment(previous, current);
    // Copy samples: callers may reuse a mutable event-derived object.
    previous = { ...current };
    if (!segment) return;
    if (sequence >= 2_147_483_647 || queue.length >= capacity) {
      sealed = true; capacityReached = true; previous = null; return;
    }
    queue.push(Object.freeze({ sequence: sequence++, startElapsedMs: segment.wallStartMs,
      endElapsedMs: segment.wallEndMs, mediaStartMs: segment.mediaStartMs,
      mediaEndMs: segment.mediaEndMs, rate: current.rate }));
  }

  async function deliver() {
    try {
      while (queue.length && !rejected) {
        const batch = Object.freeze(queue.slice(0, 20));
        const reply = await transport.append(batch);
        if (!reply.ok) { rejected = !reply.retryable; return; }
        // Never discard evidence on malformed or unrelated acknowledgements.
        if (reply.lastSequence !== batch[batch.length - 1].sequence) { rejected = true; return; }
        queue.splice(0, batch.length);
      }
      if (sealed && !capacityReached && !collectionLost && !rejected && !queue.length) terminal = (await transport.close(sequence - 1)).terminal;
    } catch {
      // Unknown delivery outcome: retain the same sequence/payload for replay.
    }
  }

  function flush(): Promise<void> {
    if (pending) return pending;
    if (terminal || rejected) return Promise.resolve();
    // Defer start so a synchronous finish following an empty flush still
    // observes the sealed state and sends its terminal request.
    pending = Promise.resolve().then(deliver).finally(() => { pending = null; });
    return pending;
  }

  return {
    sample,
    reset() { previous = null; },
    abandon() {
      // Preserve the retained prefix but never certify closure after access or
      // lease continuity is lost. Later finish cannot undo this loss marker.
      collectionLost = true; sealed = true; previous = null;
      return flush();
    },
    flush,
    finish() {
      sealed = true; previous = null;
      // The active pass may already have checked sealed but not yet cleared
      // pending. One follow-up pass observes the seal after that handoff.
      return pending ? pending.then(() => flush()) : flush();
    },
    state() { return { queued: queue.length, finalSequence: sequence - 1, sealed, terminal, rejected, capacityReached, collectionLost }; },
  };
}
