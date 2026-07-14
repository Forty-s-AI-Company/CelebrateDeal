/**
 * Returns a new event sequence with one item moved to a different position.
 * Event objects are intentionally not cloned so every event property remains
 * unchanged while only the sequence is updated.
 */
export function reorderInteractionEvents<T>(events: readonly T[], fromIndex: number, toIndex: number): T[] {
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
  return reordered;
}
