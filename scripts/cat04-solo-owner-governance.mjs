const OWNER_REF_PATTERN = /^[a-z0-9:_-]+$/u;

const REQUIRED_MATCHES = Object.freeze([
  "orderIdentity",
  "providerReference",
  "amount",
  "paymentStatus",
  "refundStatus",
  "callbackLocalState",
]);

const PROVIDER_EVIDENCE_KINDS = new Set(["READ_ONLY_QUERY", "PROVIDER_ISSUED_RECEIPT", "CONTROLLED_AUDIT_RECORD"]);

/**
 * Owner metadata is optional evidence metadata. It is not a substitute for
 * environment, provider, transaction or reconciliation evidence.
 */
export function validateCat04Authorization(input) {
  const errors = [];
  const ownerRefs = [input?.stagingOwnerRef, input?.payUniOwnerRef].filter((value) => value !== undefined);
  for (const ownerRef of ownerRefs) {
    if (typeof ownerRef !== "string" || !OWNER_REF_PATTERN.test(ownerRef)) errors.push("OWNER_REF_INVALID");
  }
  if (input?.stagingOwnerRef !== undefined && input?.payUniOwnerRef !== undefined && input.stagingOwnerRef === input.payUniOwnerRef && input.sameHumanMultipleRoles !== true) {
    errors.push("SHARED_OWNER_FLAG_MISSING");
  }
  if (input?.authorizationRecordRef !== undefined && (typeof input.authorizationRecordRef !== "string" || input.authorizationRecordRef.trim() === "")) {
    errors.push("AUTHORIZATION_REF_INVALID");
  }
  return { ok: errors.length === 0, errors: [...new Set(errors)] };
}

function hasVerifiedIdentity(input, field, blocker) {
  return input?.[field] === true ? null : blocker;
}

function validateProviderEvidence(input) {
  const evidence = input?.providerEvidence;
  if (!evidence || !PROVIDER_EVIDENCE_KINDS.has(evidence.kind)) return "PROVIDER_EVIDENCE_UNVERIFIABLE";
  if (evidence.kind === "READ_ONLY_QUERY") {
    if (evidence.queryType !== "READ_ONLY" || evidence.bounded !== true || evidence.auditable !== true) return "PROVIDER_QUERY_UNSAFE";
    if (!Number.isInteger(evidence.attemptCount) || evidence.attemptCount < 1) return "PROVIDER_QUERY_ATTEMPT_COUNT_INVALID";
  }
  if (typeof evidence.providerEnvironment !== "string" || evidence.providerEnvironment.trim() === "") return "PROVIDER_ENVIRONMENT_UNVERIFIABLE";
  if (typeof evidence.timestamp !== "string" || evidence.timestamp.trim() === "") return "PROVIDER_EVIDENCE_TIMESTAMP_MISSING";
  if (typeof evidence.resultClassification !== "string" || evidence.resultClassification.trim() === "") return "PROVIDER_RESULT_CLASSIFICATION_MISSING";
  return null;
}

/**
 * CAT04 is an outcome gate. Freshness, environment names, one-attempt limits
 * and a particular receipt shape are deliberately not required here.
 */
export function evaluateCat04Reconciliation(input) {
  const blockers = [];
  const identityChecks = [
    ["environmentIdentity", "ENVIRONMENT_IDENTITY_UNVERIFIABLE"],
    ["providerAccountIdentity", "PROVIDER_ACCOUNT_IDENTITY_UNVERIFIABLE"],
    ["providerEnvironmentIdentity", "PROVIDER_ENVIRONMENT_IDENTITY_UNVERIFIABLE"],
  ];
  for (const [field, blocker] of identityChecks) {
    const error = hasVerifiedIdentity(input, field, blocker);
    if (error) blockers.push(error);
  }
  if (input?.nonProduction !== true || input?.production === true) blockers.push("PRODUCTION_BOUNDARY_INVALID");

  const providerEvidenceError = validateProviderEvidence(input);
  if (providerEvidenceError) blockers.push(providerEvidenceError);

  const safetyChecks = [
    ["orderIdentityVerified", "ORDER_IDENTITY_UNVERIFIABLE"],
    ["signatureVerified", "SIGNATURE_SAFETY_UNVERIFIABLE"],
    ["idempotencySafe", "IDEMPOTENCY_SAFETY_UNVERIFIABLE"],
  ];
  for (const [field, blocker] of safetyChecks) {
    const error = hasVerifiedIdentity(input, field, blocker);
    if (error) blockers.push(error);
  }

  if (input?.productionSecretExposed === true || input?.rawPaymentDataPersisted === true || input?.rawProviderPayloadPersisted === true || input?.sensitiveDataExposed === true) {
    blockers.push("SENSITIVE_DATA_EXPOSED");
  }

  for (const field of REQUIRED_MATCHES) {
    if (input?.matches?.[field] !== "MATCHED") blockers.push(`RECONCILIATION_UNVERIFIABLE:${field}`);
  }
  if (input?.refundRecordConsistent !== true) blockers.push("REFUND_RECORD_UNVERIFIABLE");

  return { status: blockers.length === 0 ? "PAYMENT_RECONCILIATION_READY" : "BLOCKED", blockers: [...new Set(blockers)] };
}
