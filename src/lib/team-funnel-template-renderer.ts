import {
  resolveTeamFunnelDynamicField,
  type TeamFunnelDynamicFieldContext,
  type TeamFunnelDynamicFieldResult,
} from "./team-funnel-dynamic-fields";

export type TeamFunnelTemplateTokenResult = {
  placeholder: string;
  field: string;
  result: TeamFunnelDynamicFieldResult;
};

export type TeamFunnelTemplateRenderResult = {
  text: string;
  tokens: TeamFunnelTemplateTokenResult[];
};

const templateTokenPattern = /{{([^{}]*)}}/g;

/**
 * Replaces double-curly-brace template tokens through the explicit dynamic-field
 * allowlist. Replacement values remain ordinary text and are never re-parsed.
 */
export function renderTeamFunnelTemplateText(
  template: string,
  context: TeamFunnelDynamicFieldContext,
): TeamFunnelTemplateRenderResult {
  const tokens: TeamFunnelTemplateTokenResult[] = [];
  const text = template.replace(templateTokenPattern, (placeholder, rawField: string) => {
    const field = rawField.trim();
    const result = resolveTeamFunnelDynamicField(field, context);

    tokens.push({ placeholder, field, result });
    return result.value;
  });

  return { text, tokens };
}
