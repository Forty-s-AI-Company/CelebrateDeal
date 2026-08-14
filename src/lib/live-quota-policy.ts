export const LIVE_QUOTA_POLICY_VERSION = 2;
export const STREAM_USAGE_BPS_TOTAL = 10_000;
const AFFILIATE_CODE_PATTERN = /^[A-Z0-9_-]{1,80}$/;
const MEMBERSHIP_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export type LiveAffiliateMode = "enabled" | "disabled";
export type LiveUsageAttributionMode = "PROMOTER" | "OWNER" | "SPLIT" | "CUSTOM";
export type LiveQuotaPayerScope = "VENDOR" | "MEMBER";

export type LiveCustomUsageAllocation = {
  teamId: string;
  membershipId: string;
  bps: number;
};

export type LiveMemberQuota = {
  teamId: string;
  membershipId: string;
  includedMinutes: number;
};

export type LivePageQuota = {
  pageId: string;
  includedMinutes: number;
};

export type LiveQuotaPolicy = {
  version: typeof LIVE_QUOTA_POLICY_VERSION;
  affiliateMode: LiveAffiliateMode;
  defaultAffiliateCode: string | null;
  maxConcurrentViewers: number;
  stopWhenCreditsBelow: number;
  quotaPayerScope: LiveQuotaPayerScope;
  usageAttributionMode: LiveUsageAttributionMode;
  splitOwnerBps: number;
  splitPromoterBps: number;
  customAllocations: LiveCustomUsageAllocation[];
  memberQuotas: LiveMemberQuota[];
  pageQuotas: LivePageQuota[];
};

export type LiveQuotaPolicyFormInput = {
  affiliateMode?: string | null;
  defaultAffiliateCode?: string | null;
  maxConcurrentViewers?: number;
  stopWhenCreditsBelow?: number;
  quotaPayerScope?: string | null;
  usageAttributionMode?: string | null;
  splitOwnerBps?: number;
  splitPromoterBps?: number;
  customAllocations?: unknown;
  memberQuotas?: unknown;
  pageQuotas?: unknown;
};

export class LiveQuotaPolicyValidationError extends Error {}

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new LiveQuotaPolicyValidationError("invalid_live_quota_policy");
  }
  return value;
}

function normalizeAffiliateCode(value: string | null | undefined) {
  const normalized = value?.trim().toUpperCase() ?? "";
  if (!normalized) return null;
  if (!AFFILIATE_CODE_PATTERN.test(normalized)) {
    throw new LiveQuotaPolicyValidationError("invalid_live_quota_policy");
  }
  return normalized;
}

function normalizeMembershipId(value: unknown) {
  if (typeof value !== "string") throw new LiveQuotaPolicyValidationError("invalid_live_quota_policy");
  const normalized = value.trim();
  if (!MEMBERSHIP_ID_PATTERN.test(normalized)) throw new LiveQuotaPolicyValidationError("invalid_live_quota_policy");
  return normalized;
}

function normalizeQuotaMinutes(value: unknown) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 1_000_000) {
    throw new LiveQuotaPolicyValidationError("invalid_live_quota_policy");
  }
  return value;
}

function parseArrayValue(value: unknown) {
  if (value == null || value === "") return [];
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      throw new LiveQuotaPolicyValidationError("invalid_live_quota_policy");
    }
  }
  return value;
}

function normalizeCustomAllocations(value: unknown): LiveCustomUsageAllocation[] {
  const parsed = parseArrayValue(value);
  if (!Array.isArray(parsed)) throw new LiveQuotaPolicyValidationError("invalid_live_quota_policy");

  const allocations = parsed.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new LiveQuotaPolicyValidationError("invalid_live_quota_policy");
    }
    const raw = item as Record<string, unknown>;
    if (typeof raw.bps !== "number") throw new LiveQuotaPolicyValidationError("invalid_live_quota_policy");
    return {
      teamId: normalizeMembershipId(raw.teamId),
      membershipId: normalizeMembershipId(raw.membershipId),
      bps: boundedInteger(raw.bps, 0, 1, STREAM_USAGE_BPS_TOTAL),
    };
  });
  const keys = new Set<string>();
  for (const allocation of allocations) {
    const key = `${allocation.teamId}:${allocation.membershipId}`;
    if (keys.has(key)) throw new LiveQuotaPolicyValidationError("invalid_live_quota_policy");
    keys.add(key);
  }
  return allocations;
}

function normalizeMemberQuotas(value: unknown): LiveMemberQuota[] {
  const parsed = parseArrayValue(value);
  if (!Array.isArray(parsed)) throw new LiveQuotaPolicyValidationError("invalid_live_quota_policy");
  const quotas = parsed.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new LiveQuotaPolicyValidationError("invalid_live_quota_policy");
    }
    const raw = item as Record<string, unknown>;
    return {
      teamId: normalizeMembershipId(raw.teamId),
      membershipId: normalizeMembershipId(raw.membershipId),
      includedMinutes: normalizeQuotaMinutes(raw.includedMinutes),
    };
  });
  const keys = new Set<string>();
  for (const quota of quotas) {
    const key = `${quota.teamId}:${quota.membershipId}`;
    if (keys.has(key)) throw new LiveQuotaPolicyValidationError("invalid_live_quota_policy");
    keys.add(key);
  }
  return quotas;
}

function normalizePageQuotas(value: unknown): LivePageQuota[] {
  const parsed = parseArrayValue(value);
  if (!Array.isArray(parsed)) throw new LiveQuotaPolicyValidationError("invalid_live_quota_policy");
  const quotas = parsed.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new LiveQuotaPolicyValidationError("invalid_live_quota_policy");
    }
    const raw = item as Record<string, unknown>;
    return {
      pageId: normalizeMembershipId(raw.pageId),
      includedMinutes: normalizeQuotaMinutes(raw.includedMinutes),
    };
  });
  const keys = new Set<string>();
  for (const quota of quotas) {
    if (keys.has(quota.pageId)) throw new LiveQuotaPolicyValidationError("invalid_live_quota_policy");
    keys.add(quota.pageId);
  }
  return quotas;
}

export function parseLiveQuotaPolicyForm(input: LiveQuotaPolicyFormInput): LiveQuotaPolicy {
  const affiliateMode = input.affiliateMode == null || input.affiliateMode === ""
    ? "enabled"
    : input.affiliateMode;
  if (affiliateMode !== "enabled" && affiliateMode !== "disabled") {
    throw new LiveQuotaPolicyValidationError("invalid_live_quota_policy");
  }

  const quotaPayerScope = input.quotaPayerScope == null || input.quotaPayerScope === ""
    ? "VENDOR"
    : input.quotaPayerScope;
  if (quotaPayerScope !== "VENDOR" && quotaPayerScope !== "MEMBER") {
    throw new LiveQuotaPolicyValidationError("invalid_live_quota_policy");
  }

  const usageAttributionMode = input.usageAttributionMode == null || input.usageAttributionMode === ""
    ? "PROMOTER"
    : input.usageAttributionMode;
  if (!(["PROMOTER", "OWNER", "SPLIT", "CUSTOM"] as const).includes(usageAttributionMode as LiveUsageAttributionMode)) {
    throw new LiveQuotaPolicyValidationError("invalid_live_quota_policy");
  }
  const splitOwnerBps = boundedInteger(input.splitOwnerBps, 3_000, 0, STREAM_USAGE_BPS_TOTAL);
  const splitPromoterBps = boundedInteger(input.splitPromoterBps, 7_000, 0, STREAM_USAGE_BPS_TOTAL);
  if (usageAttributionMode === "SPLIT" && splitOwnerBps + splitPromoterBps !== STREAM_USAGE_BPS_TOTAL) {
    throw new LiveQuotaPolicyValidationError("invalid_live_quota_policy");
  }
  const customAllocations = normalizeCustomAllocations(input.customAllocations);
  if (usageAttributionMode === "CUSTOM" && (
    customAllocations.length === 0
    || customAllocations.reduce((sum, allocation) => sum + allocation.bps, 0) !== STREAM_USAGE_BPS_TOTAL
  )) {
    throw new LiveQuotaPolicyValidationError("invalid_live_quota_policy");
  }
  if (usageAttributionMode !== "CUSTOM" && customAllocations.length > 0) {
    throw new LiveQuotaPolicyValidationError("invalid_live_quota_policy");
  }
  const memberQuotas = normalizeMemberQuotas(input.memberQuotas);
  const pageQuotas = normalizePageQuotas(input.pageQuotas);
  if (quotaPayerScope === "MEMBER" && memberQuotas.length === 0 && customAllocations.length === 0) {
    throw new LiveQuotaPolicyValidationError("invalid_live_quota_policy");
  }

  return {
    version: LIVE_QUOTA_POLICY_VERSION,
    affiliateMode,
    defaultAffiliateCode: normalizeAffiliateCode(input.defaultAffiliateCode),
    maxConcurrentViewers: boundedInteger(input.maxConcurrentViewers, 500, 1, 100_000),
    stopWhenCreditsBelow: boundedInteger(input.stopWhenCreditsBelow, 300, 0, 1_000_000),
    quotaPayerScope: quotaPayerScope as LiveQuotaPayerScope,
    usageAttributionMode: usageAttributionMode as LiveUsageAttributionMode,
    splitOwnerBps,
    splitPromoterBps,
    customAllocations,
    memberQuotas,
    pageQuotas,
  };
}

export function parseLiveQuotaPolicy(value: unknown): LiveQuotaPolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) return parseLiveQuotaPolicyForm({});
  const raw = value as Record<string, unknown>;
  try {
    return parseLiveQuotaPolicyForm({
      affiliateMode: typeof raw.affiliateMode === "string" ? raw.affiliateMode : undefined,
      defaultAffiliateCode: typeof raw.defaultAffiliateCode === "string" ? raw.defaultAffiliateCode : undefined,
      maxConcurrentViewers: typeof raw.maxConcurrentViewers === "number" ? raw.maxConcurrentViewers : undefined,
      stopWhenCreditsBelow: typeof raw.stopWhenCreditsBelow === "number" ? raw.stopWhenCreditsBelow : undefined,
      quotaPayerScope: typeof raw.quotaPayerScope === "string" ? raw.quotaPayerScope : undefined,
      usageAttributionMode: typeof raw.usageAttributionMode === "string" ? raw.usageAttributionMode : undefined,
      splitOwnerBps: typeof raw.splitOwnerBps === "number" ? raw.splitOwnerBps : undefined,
      splitPromoterBps: typeof raw.splitPromoterBps === "number" ? raw.splitPromoterBps : undefined,
      customAllocations: raw.customAllocations,
      memberQuotas: raw.memberQuotas,
      pageQuotas: raw.pageQuotas,
    });
  } catch {
    // Legacy or malformed policy data must fail closed for referral attribution,
    // while keeping a deterministic safe display shape for the management UI.
    return { ...parseLiveQuotaPolicyForm({}), affiliateMode: "disabled", defaultAffiliateCode: null };
  }
}

export function allowsLegacyAffiliateAttribution(value: unknown) {
  return parseLiveQuotaPolicy(value).affiliateMode === "enabled";
}

export function defaultAffiliateCode(value: unknown) {
  return parseLiveQuotaPolicy(value).defaultAffiliateCode;
}
