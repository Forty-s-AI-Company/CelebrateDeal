export type TeamFunnelDynamicField =
  | "partner.name"
  | "partner.displayName"
  | "partner.avatar"
  | "partner.phone"
  | "partner.email"
  | "partner.lineUrl"
  | "partner.whatsappUrl"
  | "partner.bio"
  | "partner.productUrl"
  | "partner.joinUrl"
  | "partner.referralCode"
  | "webinar.title"
  | "webinar.startAt"
  | "webinar.hostName"
  | "webinar.registrationUrl";

export type TeamFunnelDynamicFieldSource = "partner" | "webinar";

export type TeamFunnelDynamicFieldContext = {
  partner?: {
    name?: string | null;
    displayName?: string | null;
    avatar?: string | null;
    phone?: string | null;
    email?: string | null;
    lineUrl?: string | null;
    whatsappUrl?: string | null;
    bio?: string | null;
    productUrl?: string | null;
    joinUrl?: string | null;
    referralCode?: string | null;
  };
  webinar?: {
    title?: string | null;
    startAt?: string | null;
    hostName?: string | null;
    registrationUrl?: string | null;
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
    case "partner.displayName":
      return resolveKnownField(field, "partner", context.partner?.displayName);
    case "partner.avatar":
      return resolveKnownField(field, "partner", context.partner?.avatar);
    case "partner.phone":
      return resolveKnownField(field, "partner", context.partner?.phone);
    case "partner.email":
      return resolveKnownField(field, "partner", context.partner?.email);
    case "partner.lineUrl":
      return resolveKnownField(field, "partner", context.partner?.lineUrl);
    case "partner.whatsappUrl":
      return resolveKnownField(field, "partner", context.partner?.whatsappUrl);
    case "partner.bio":
      return resolveKnownField(field, "partner", context.partner?.bio);
    case "partner.productUrl":
      return resolveKnownField(field, "partner", context.partner?.productUrl);
    case "partner.joinUrl":
      return resolveKnownField(field, "partner", context.partner?.joinUrl);
    case "partner.referralCode":
      return resolveKnownField(field, "partner", context.partner?.referralCode);
    case "webinar.title":
      return resolveKnownField(field, "webinar", context.webinar?.title);
    case "webinar.startAt":
      return resolveKnownField(field, "webinar", context.webinar?.startAt);
    case "webinar.hostName":
      return resolveKnownField(field, "webinar", context.webinar?.hostName);
    case "webinar.registrationUrl":
      return resolveKnownField(field, "webinar", context.webinar?.registrationUrl);
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
