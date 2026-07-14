export const interactionRoleDefaultLabels = {
  official: "官方角色",
  ai_host: "AI 主持人",
  system_assistant: "系統助手",
  support: "客服助手",
} as const;

export type InteractionRoleType = keyof typeof interactionRoleDefaultLabels;

const fallbackRoleType: InteractionRoleType = "official";

export function getInteractionRoleDefaultLabel(roleType: string) {
  return interactionRoleDefaultLabels[roleType as InteractionRoleType] ?? interactionRoleDefaultLabels[fallbackRoleType];
}

export function getInteractionRoleLabelOnTypeChange(
  currentLabel: string,
  previousRoleType: string,
  nextRoleType: string,
) {
  const previousDefaultLabel = getInteractionRoleDefaultLabel(previousRoleType);

  if (currentLabel.trim() === "" || currentLabel === previousDefaultLabel) {
    return getInteractionRoleDefaultLabel(nextRoleType);
  }

  return currentLabel;
}
