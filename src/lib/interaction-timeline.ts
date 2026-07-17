type TimedInteractionEvent = {
  triggerSec: number;
};

/**
 * Returns a new event sequence with one item moved to a different position.
 *
 * The timeline's existing trigger times are treated as ordered slots. After an
 * event moves, every event receives the slot for its new position so the
 * editor sequence remains the same as the sequence used for playback.
 */
export function reorderInteractionEvents<T extends TimedInteractionEvent>(
  events: readonly T[],
  fromIndex: number,
  toIndex: number,
): T[] {
  if (
    fromIndex < 0 ||
    fromIndex >= events.length ||
    toIndex < 0 ||
    toIndex >= events.length ||
    fromIndex === toIndex
  ) {
    return [...events];
  }

  const reordered = [...events];
  const [event] = reordered.splice(fromIndex, 1);
  reordered.splice(toIndex, 0, event);

  const triggerSecSlots = events.map((item) => item.triggerSec).sort((first, second) => first - second);
  return reordered.map((item, index) => ({ ...item, triggerSec: triggerSecSlots[index] }));
}
