import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { DERIVED_KEY_ROTATIONS } from "@/lib/derived-key-purposes";

/**
 * Every derived-key purpose used in production code must be registered in
 * DERIVED_KEY_ROTATIONS (docs/staging-production-env-vars.md §7), so a new
 * purpose cannot ship without its rotation entry. Purposes that are not yet
 * rotated, or that are built at run time, are listed below with a reason.
 *
 * The scan is static: it finds every call of deriveSensitiveDataKey,
 * encryptSensitiveValue and decryptSensitiveValue, takes the purpose argument
 * and resolves it to a string literal, a registry entry or a same-file
 * constant. Anything else must be allow-listed for that exact file and
 * expression.
 */
const SRC = join(process.cwd(), "src");

function collect(dir: string, out: string[] = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) collect(full, out);
    else if (/\.(ts|tsx|mts|cts)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

const files = collect(SRC).map((full) => ({
  path: relative(SRC, full).split(sep).join("/"),
  source: readFileSync(full, "utf8"),
}));

/** Purpose argument position per KDF entry point. */
const ENTRY_POINTS = { deriveSensitiveDataKey: 0, encryptSensitiveValue: 1, decryptSensitiveValue: 1 } as const;

/** Files that define the KDF or only ever receive registry entries. */
const KDF_IMPLEMENTATION_FILES = new Set([
  // Defines the three entry points.
  "lib/sensitive-data.ts",
  // Rotation helpers: every purpose they pass comes from a DerivedKeyRotation argument.
  "lib/derived-key-rotation.ts",
]);

/** Reasons, so each allow-listed purpose says why it is not in the registry yet. */
const AT_REST = "第 4 級：靜態資料加密金鑰（依紀錄綁定的用途），尚未輪替；改名需要 re-encrypt migration（B04-03 的 PII 階段）";
const HASH_INDEX = "第 4 級：雜湊索引／去重金鑰，尚未輪替；改名需要重算既有索引（B04-03 的 PII 階段）";
const REGISTRY_VARIABLE = "值在執行時取自 DERIVED_KEY_ROTATIONS 的 current／legacy（mfaEncryption、mfaRecoveryCode、livePrivateChatCursor），靜態掃描無法追蹤這個變數";

/**
 * `<file> <purpose expression>` → reason. Keep each reason specific; an entry
 * that no longer matches any call fails the test, so the list cannot rot.
 */
const ALLOWED_UNREGISTERED: Record<string, string> = {
  "app/actions/interaction-actions.ts luckyDrawClaimEnvelopePurpose(vendor.id, winner.id)": AT_REST,
  "app/api/live-interactions/route.ts luckyDrawClaimEnvelopePurpose(run.vendorId, winnerResponse.id)": AT_REST,
  "lib/automation-workflow.ts \"automation-customer-key-v1\"": HASH_INDEX,
  "lib/cloudflare-ops.ts CLOUDFLARE_STREAM_KEY_PURPOSE": AT_REST,
  "lib/commerce-custom-checkout.ts CHECKOUT_IDENTITY_FINGERPRINT_PURPOSE": HASH_INDEX,
  "lib/commerce-custom-checkout.ts purpose(binding)": AT_REST,
  "lib/commerce-entitlement-access.ts purpose(safe)": AT_REST,
  "lib/commerce-entitlement-access.ts purpose(binding)": AT_REST,
  "lib/commerce-order-pii.ts IDENTITY_FINGERPRINT_PURPOSE": HASH_INDEX,
  "lib/commerce-order-pii.ts envelopePurpose(BUYER_ENVELOPE_PURPOSE, safeBinding)": AT_REST,
  "lib/commerce-order-pii.ts envelopePurpose(SHIPPING_ENVELOPE_PURPOSE, safeBinding)": AT_REST,
  "lib/email-delivery-pii.ts RECIPIENT_HASH_PURPOSE": HASH_INDEX,
  "lib/email-delivery-pii.ts recipientPurpose(binding)": AT_REST,
  "lib/learner-notification-contract.ts \"learner-notification-destination-index-v1\"": HASH_INDEX,
  "lib/learner-notification-contract.ts \"learner-notification-destination-rate-v1\"": HASH_INDEX,
  "lib/learner-notification-contract.ts \"learner-notification-delivery-key-v1\"": HASH_INDEX,
  "lib/learner-notification-contract.ts binding": AT_REST,
  "lib/learner-notification-contract.ts purpose(scope, channel)": AT_REST,
  "lib/learner-notification-dispatch.ts `learner-notification-payload-v1:${JSON.stringify([input.vendorId,row.deduplicationKey])}`": AT_REST,
  "lib/learner-notification-outbox.ts payloadPurpose(scope.vendorId,key)": AT_REST,
  "lib/learner-notification-outbox.ts `learner-notification-receipt-v1:${JSON.stringify([input.vendorId,input.id])}`": AT_REST,
  "lib/learner-notification-outbox.ts payloadPurpose(vendorId,row.deduplicationKey)": AT_REST,
  "lib/learner-notification-source-events.ts purpose(input)": AT_REST,
  "lib/learner-notification-source-events.ts purpose({...source,event:LearnerNotificationEvent.parse(source.event)})": AT_REST,
  "lib/learner-notification-verification.ts `learner-contact-proof-v1:${JSON.stringify([scope.vendorId,challengeId])}`": AT_REST,
  "lib/learner-verification-delivery.ts receiptPurpose(input.vendorId,input.id)": AT_REST,
  "lib/learner-verification-delivery.ts purpose(row.vendorId,row.id)": AT_REST,
  "lib/line-credentials.ts `line-user-lookup:${vendorId}`": HASH_INDEX,
  "lib/line-credentials.ts credentialPurpose(vendorId, \"messagingChannelId\")": AT_REST,
  "lib/line-credentials.ts credentialPurpose(vendorId, \"messagingChannelSecret\")": AT_REST,
  "lib/line-credentials.ts credentialPurpose(vendorId, \"messagingAccessToken\")": AT_REST,
  "lib/line-credentials.ts credentialPurpose(vendorId, \"loginChannelId\")": AT_REST,
  "lib/line-credentials.ts credentialPurpose(vendorId, \"loginChannelSecret\")": AT_REST,
  "lib/line-credentials.ts `line-profile:${vendorId}:${field}`": AT_REST,
  "lib/line-login.ts verifierPurpose(input.vendorId, stateId)": AT_REST,
  "lib/line-login.ts verifierPurpose(attempt.vendorId, attempt.id)": AT_REST,
  "lib/line-notification.ts deliveryPurpose(input.vendorId, id)": AT_REST,
  "lib/line-notification.ts deliveryPurpose(current.vendorId, current.id)": AT_REST,
  "lib/live-interaction.ts \"live-lucky-draw-claim-hash:v1\"": HASH_INDEX,
  "lib/live-private-chat-storage.ts purpose(scope)": AT_REST,
  "lib/live-private-chat.ts purpose": REGISTRY_VARIABLE,
  "lib/mfa.ts legacyPurpose": REGISTRY_VARIABLE,
  "lib/mfa.ts purpose": REGISTRY_VARIABLE,
  "lib/product-delivery.ts configPurpose(binding, \"destination\")": AT_REST,
  "lib/product-delivery.ts configPurpose(binding, \"instructions\")": AT_REST,
  "lib/product-delivery.ts snapshotPurpose(binding, \"destination\")": AT_REST,
  "lib/product-delivery.ts snapshotPurpose(binding, \"instructions\")": AT_REST,
  "lib/registration-form-retry.ts PURPOSE": AT_REST,
  "lib/support-case-pii.ts purpose(binding)": AT_REST,
  "lib/taiwan-invoice-request.ts \"commerce-order-invoice-fingerprint\"": HASH_INDEX,
  "lib/taiwan-invoice-request.ts purpose(vendorId, orderId)": AT_REST,
  "lib/tracking-browser-context.ts purpose(vendorId, sourceId)": AT_REST,
  "lib/tracking-credentials.ts purpose(vendorId)": AT_REST,
};

/** Splits the top-level arguments of the call whose "(" is at `open`. */
function callArguments(source: string, open: number) {
  const args: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = open + 1;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index]!;
    if (quote) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") quote = char;
    else if (char === "(" || char === "[" || char === "{") depth += 1;
    else if (char === ")" || char === "]" || char === "}") {
      depth -= 1;
      if (depth === 0) {
        args.push(source.slice(start, index).trim());
        return args;
      }
    } else if (char === "," && depth === 1) {
      args.push(source.slice(start, index).trim());
      start = index + 1;
    }
  }
  return args;
}

const registry = DERIVED_KEY_ROTATIONS as Record<string, { current: string; legacy: { purpose: string } | null }>;
const registeredPurposes = new Set(Object.values(registry).flatMap((rotation) => [rotation.current, ...(rotation.legacy ? [rotation.legacy.purpose] : [])]));

type Resolution = { kind: "registered" } | { kind: "unregistered"; detail: string };

function resolveRegistryReference(expression: string): boolean {
  const match = /^DERIVED_KEY_ROTATIONS\.(\w+)\.(current|legacy(?:\?|!)?\.purpose)$/u.exec(expression);
  return Boolean(match && registry[match[1]!]);
}

function constantValue(source: string, name: string) {
  const match = new RegExp(`(?:const|let)\\s+${name}\\s*(?::[^=]+)?=\\s*([^;\\n]+)`, "u").exec(source);
  return match?.[1]?.trim() ?? null;
}

function resolve(source: string, expression: string, depth = 0): Resolution {
  const literal = /^(["'`])([^"'`$]*)\1$/u.exec(expression);
  if (literal) return registeredPurposes.has(literal[2]!) ? { kind: "registered" } : { kind: "unregistered", detail: literal[2]! };
  if (resolveRegistryReference(expression)) return { kind: "registered" };
  // `NAME` or `NAME.current` where NAME is a same-file constant.
  const identifier = /^(\w+)(\.current)?$/u.exec(expression);
  if (identifier && depth < 3) {
    const value = constantValue(source, identifier[1]!);
    if (value) return resolve(source, identifier[2] ? `${value}${identifier[2]}` : value, depth + 1);
  }
  return { kind: "unregistered", detail: expression };
}

function findings() {
  const results: Array<{ key: string; detail: string }> = [];
  for (const file of files) {
    if (KDF_IMPLEMENTATION_FILES.has(file.path)) continue;
    for (const [entry, position] of Object.entries(ENTRY_POINTS)) {
      const pattern = new RegExp(`\\b${entry}\\(`, "gu");
      for (const match of file.source.matchAll(pattern)) {
        // Skip definitions and type positions.
        const before = file.source.slice(Math.max(0, match.index! - 9), match.index!);
        if (/function\s*$/u.test(before)) continue;
        const purpose = callArguments(file.source, match.index! + entry.length)[position];
        if (purpose === undefined) continue;
        const resolution = resolve(file.source, purpose);
        if (resolution.kind === "unregistered") results.push({ key: `${file.path} ${purpose}`, detail: resolution.detail });
      }
    }
  }
  return results;
}

describe("derived-key purpose registry coverage", () => {
  const found = findings();

  it("scans the source tree and finds the KDF call sites", () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files.some((file) => /\bderiveSensitiveDataKey\(/u.test(file.source) && !KDF_IMPLEMENTATION_FILES.has(file.path))).toBe(true);
  });

  it("registers every purpose in DERIVED_KEY_ROTATIONS or allow-lists it with a reason", () => {
    const missing = found.filter((item) => !(item.key in ALLOWED_UNREGISTERED)).map((item) => item.key);
    expect(missing, "新的衍生金鑰用途必須登記在 DERIVED_KEY_ROTATIONS（src/lib/derived-key-purposes.ts）").toEqual([]);
  });

  it("keeps the allow-list current and explained", () => {
    const keys = new Set(found.map((item) => item.key));
    expect(Object.keys(ALLOWED_UNREGISTERED).filter((key) => !keys.has(key)), "allow-list 中已不存在的項目請移除").toEqual([]);
    for (const [key, reason] of Object.entries(ALLOWED_UNREGISTERED)) expect(reason.length, key).toBeGreaterThan(10);
  });

  it("resolves the registered purposes it relies on", () => {
    expect(resolve("", "DERIVED_KEY_ROTATIONS.merchantEmailVerification.current")).toEqual({ kind: "registered" });
    expect(resolve("", "\"merchant-email-verification:r2:5a881e5879ba6156\"")).toEqual({ kind: "registered" });
    expect(resolve("const X = DERIVED_KEY_ROTATIONS.checkoutAdmission;", "X.current")).toEqual({ kind: "registered" });
    expect(resolve("", "\"brand-new-purpose\"")).toEqual({ kind: "unregistered", detail: "brand-new-purpose" });
    expect(resolve("", "DERIVED_KEY_ROTATIONS.doesNotExist.current")).toMatchObject({ kind: "unregistered" });
  });
});
