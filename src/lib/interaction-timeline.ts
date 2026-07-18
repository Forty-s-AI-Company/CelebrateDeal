type TimedInteractionEvent = {
  triggerSec: number;
};

export const INTERACTION_TIME_FORMAT_ERROR =
  "時間必須為非負整數秒數、MM:SS 或 HH:MM:SS，且分鐘與秒數不可超過 59。";

/**
 * Parses the only timestamp formats accepted by interaction scripts:
 * non-negative integer seconds, MM:SS, and HH:MM:SS.
 */
export function parseInteractionTriggerSeconds(value: string): number | null {
  if (/^\d+$/.test(value)) {
    const seconds = Number(value);
    return Number.isSafeInteger(seconds) ? seconds : null;
  }

  const minuteSecondMatch = /^(\d{2}):(\d{2})$/.exec(value);
  if (minuteSecondMatch) {
    const minutes = Number(minuteSecondMatch[1]);
    const seconds = Number(minuteSecondMatch[2]);
    if (minutes <= 59 && seconds <= 59) return minutes * 60 + seconds;
    return null;
  }

  const hourMinuteSecondMatch = /^(\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (hourMinuteSecondMatch) {
    const hours = Number(hourMinuteSecondMatch[1]);
    const minutes = Number(hourMinuteSecondMatch[2]);
    const seconds = Number(hourMinuteSecondMatch[3]);
    if (Number.isSafeInteger(hours) && minutes <= 59 && seconds <= 59) {
      const totalSeconds = hours * 3600 + minutes * 60 + seconds;
      return Number.isSafeInteger(totalSeconds) ? totalSeconds : null;
    }
  }

  return null;
}

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
