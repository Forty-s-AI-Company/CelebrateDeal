export type InteractionRoleEventReference = {
  eventType: string;
  script: {
    id: string;
    name: string;
    status: string;
    _count: { lives: number };
  };
};

export type InteractionRoleUsage = {
  scriptId: string;
  scriptName: string;
  scriptStatus: string;
  eventCount: number;
  publicMessageCount: number;
  liveCount: number;
};

/** Builds a bounded merchant-facing impact summary without exposing event content. */
export function summarizeInteractionRoleUsage(
  references: InteractionRoleEventReference[],
): InteractionRoleUsage[] {
  const byScript = new Map<string, InteractionRoleUsage>();

  for (const reference of references) {
    const current = byScript.get(reference.script.id) ?? {
      scriptId: reference.script.id,
      scriptName: reference.script.name,
      scriptStatus: reference.script.status,
      eventCount: 0,
      publicMessageCount: 0,
      liveCount: reference.script._count.lives,
    };
    current.eventCount += 1;
    if (reference.eventType === "chat_message" || reference.eventType === "reminder") {
      current.publicMessageCount += 1;
    }
    byScript.set(reference.script.id, current);
  }

  return [...byScript.values()].sort((left, right) => (
    right.publicMessageCount - left.publicMessageCount
    || right.eventCount - left.eventCount
    || left.scriptName.localeCompare(right.scriptName, "zh-Hant")
  ));
}
