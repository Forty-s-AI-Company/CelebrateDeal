export type TeamFunnelDynamicField =
  | "partner.name"
  | "partner.productUrl"
  | "webinar.title";

export type TeamFunnelDynamicFieldSource = "partner" | "webinar";

export type TeamFunnelDynamicFieldContext = {
  partner?: {
    name?: string | null;
    productUrl?: string | null;
  };
  webinar?: {
    title?: string | null;
  };
};

type ResolvedDynamicField = {
  status: "resolved";
  field: TeamFunnelDynamicField;
  source: TeamFunnelDynamicFieldSource;
  value: string;
};

type MissingDynamicField = {
  status: "missing";
  field: TeamFunnelDynamicField;
  source: TeamFunnelDynamicFieldSource;
  value: string;
};

type UnsupportedDynamicField = {
  status: "unsupported";
  field: string;
  value: string;
};

export type TeamFunnelDynamicFieldResult =
  | ResolvedDynamicField
  | MissingDynamicField
  | UnsupportedDynamicField;

const missingValue = (field: TeamFunnelDynamicField) => `[Missing ${field}]`;

const unsupportedValue = (field: string) => `[Unsupported field: ${field}]`;

/**
 * Resolves the small, explicitly allowlisted set of team-funnel dynamic fields.
 * Values are returned as ordinary text; rendering code remains responsible for
 * context-appropriate escaping.
 */
export function resolveTeamFunnelDynamicField(
  field: string,
  context: TeamFunnelDynamicFieldContext,
): TeamFunnelDynamicFieldResult {
  switch (field) {
    case "partner.name":
      return resolveKnownField(field, "partner", context.partner?.name);
    case "partner.productUrl":
      return resolveKnownField(field, "partner", context.partner?.productUrl);
    case "webinar.title":
      return resolveKnownField(field, "webinar", context.webinar?.title);
    default:
      return {
        status: "unsupported",
        field,
        value: unsupportedValue(field),
      };
  }
}

function resolveKnownField(
  field: TeamFunnelDynamicField,
  source: TeamFunnelDynamicFieldSource,
  value: unknown,
): ResolvedDynamicField | MissingDynamicField {
  if (typeof value !== "string" || value === "") {
    return {
      status: "missing",
      field,
      source,
      value: missingValue(field),
    };
  }

  return {
    status: "resolved",
    field,
    source,
    value,
  };
}
