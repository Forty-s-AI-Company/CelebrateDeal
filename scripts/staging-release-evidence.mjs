export const STAGING_RELEASE_EVIDENCE_SCHEMA = "celebratedeal-staging-release-evidence/v1";

const SAFE_OPAQUE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/u;
const SAFE_SOURCE_COMMIT = /^[a-f0-9]{7,40}$/u;
const ALLOWED_ENVIRONMENTS = new Set(["staging", "isolated-restore-drill"]);
const ALLOWED_RESULTS = new Set(["PASS", "FAILED", "BLOCKED"]);
const ALLOWED_COMPONENT_RESULTS = new Set(["PASS", "FAILED", "BLOCKED", "NOT_PROVEN"]);

export const STAGING_RELEASE_COMPONENTS = Object.freeze([
  "lineage",
  "migration",
  "recovery",
  "rollback",
]);

const RECEIPT_KEYS = [
  "schemaVersion",
  "workPackage",
  "sourceCommit",
  "result",
  "runId",
  "executedAtUtc",
  "authorizationRecordRef",
  "environmentClass",
  "nonProduction",
  "components",
  "safety",
  "sideEffects",
];

const COMPONENT_KEYS = ["result", "sourceCommit", "evidenceRef"];

const SAFETY_KEYS = [
  "sanitized",
  "rawOutputPersisted",
  "rawArtifactPersisted",
  "credentialsPersisted",
  "tokensPersisted",
  "cookiesPersisted",
  "customerDataPersisted",
];

const SIDE_EFFECT_KEYS = [
  "databaseReads",
  "databaseWrites",
  "migrationWrites",
  "backupWrites",
  "restoreWrites",
  "deploymentOperations",
  "productionOperations",
];

function exactKeys(value, keys) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function opaqueReference(value) {
  return typeof value === "string" && SAFE_OPAQUE_REFERENCE.test(value) ? value : "unknown";
}

function sourceCommit(value) {
  return typeof value === "string" && SAFE_SOURCE_COMMIT.test(value) ? value : "unknown";
}

function environmentClass(value) {
  return ALLOWED_ENVIRONMENTS.has(value) ? value : "unknown";
}

function safeUtc(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)) return "unknown";
  return Number.isNaN(Date.parse(value)) ? "unknown" : value;
}

function nonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function normalizeComponent(value) {
  return {
    result: ALLOWED_COMPONENT_RESULTS.has(value?.result) ? value.result : "NOT_PROVEN",
    sourceCommit: sourceCommit(value?.sourceCommit),
    evidenceRef: opaqueReference(value?.evidenceRef),
  };
}

function normalizeComponents(value) {
  return Object.fromEntries(STAGING_RELEASE_COMPONENTS.map((component) => [component, normalizeComponent(value?.[component])]));
}

function normalizeSideEffects(value) {
  return Object.fromEntries(SIDE_EFFECT_KEYS.map((key) => [key, nonNegativeInteger(value?.[key])]));
}

function derivedResult({ source, authorization, environment, nonProduction, components }) {
  if (STAGING_RELEASE_COMPONENTS.some((component) => components[component].result === "FAILED")) return "FAILED";

  const complete = source !== "unknown"
    && authorization !== "unknown"
    && environment === "staging"
    && nonProduction === true
    && STAGING_RELEASE_COMPONENTS.every((component) => {
      const value = components[component];
      return value.result === "PASS"
        && value.sourceCommit === source
        && value.evidenceRef !== "unknown";
    });

  return complete ? "PASS" : "BLOCKED";
}

/**
 * Builds a value-free aggregate from already-sanitized staging gate facts.
 * Raw deployment output, database dumps and credentials must never be passed here.
 */
export function createStagingReleaseReceipt({
  sourceCommit: rawSourceCommit,
  runId,
  executedAtUtc,
  authorizationRecordRef,
  environmentClass: rawEnvironmentClass,
  nonProduction = false,
  components: rawComponents,
  sideEffects: rawSideEffects,
} = {}) {
  const commit = sourceCommit(rawSourceCommit);
  const authorization = opaqueReference(authorizationRecordRef);
  const environment = environmentClass(rawEnvironmentClass);
  const components = normalizeComponents(rawComponents);
  const sideEffects = normalizeSideEffects(rawSideEffects);

  return Object.freeze({
    schemaVersion: STAGING_RELEASE_EVIDENCE_SCHEMA,
    workPackage: "STAGING_RELEASE_EVIDENCE",
    sourceCommit: commit,
    result: derivedResult({
      source: commit,
      authorization,
      environment,
      nonProduction,
      components,
    }),
    runId: opaqueReference(runId),
    executedAtUtc: safeUtc(executedAtUtc),
    authorizationRecordRef: authorization,
    environmentClass: environment,
    nonProduction: nonProduction === true,
    components,
    safety: {
      sanitized: true,
      rawOutputPersisted: false,
      rawArtifactPersisted: false,
      credentialsPersisted: false,
      tokensPersisted: false,
      cookiesPersisted: false,
      customerDataPersisted: false,
    },
    sideEffects,
  });
}

export function validateStagingReleaseReceipt(value) {
  if (!exactKeys(value, RECEIPT_KEYS)) return false;
  if (value.schemaVersion !== STAGING_RELEASE_EVIDENCE_SCHEMA || value.workPackage !== "STAGING_RELEASE_EVIDENCE") return false;
  if (value.sourceCommit !== "unknown" && !SAFE_SOURCE_COMMIT.test(value.sourceCommit)) return false;
  if (!ALLOWED_RESULTS.has(value.result)) return false;
  if (value.runId !== "unknown" && !SAFE_OPAQUE_REFERENCE.test(value.runId)) return false;
  if (value.executedAtUtc !== "unknown" && safeUtc(value.executedAtUtc) !== value.executedAtUtc) return false;
  if (value.authorizationRecordRef !== "unknown" && !SAFE_OPAQUE_REFERENCE.test(value.authorizationRecordRef)) return false;
  if (![...ALLOWED_ENVIRONMENTS, "unknown"].includes(value.environmentClass)) return false;
  if (typeof value.nonProduction !== "boolean") return false;
  if (!exactKeys(value.components, STAGING_RELEASE_COMPONENTS)) return false;

  for (const component of STAGING_RELEASE_COMPONENTS) {
    const entry = value.components[component];
    if (!exactKeys(entry, COMPONENT_KEYS) || !ALLOWED_COMPONENT_RESULTS.has(entry.result)) return false;
    if (entry.sourceCommit !== "unknown" && !SAFE_SOURCE_COMMIT.test(entry.sourceCommit)) return false;
    if (entry.evidenceRef !== "unknown" && !SAFE_OPAQUE_REFERENCE.test(entry.evidenceRef)) return false;
    if (entry.sourceCommit !== "unknown" && (value.sourceCommit === "unknown" || entry.sourceCommit !== value.sourceCommit)) return false;
    if (entry.result === "PASS" && (entry.sourceCommit === "unknown" || entry.evidenceRef === "unknown")) return false;
  }

  if (!exactKeys(value.safety, SAFETY_KEYS) || Object.values(value.safety).some((item) => item !== false && item !== true)) return false;
  if (!exactKeys(value.sideEffects, SIDE_EFFECT_KEYS) || Object.values(value.sideEffects).some((item) => !Number.isInteger(item) || item < 0)) return false;
  if (value.safety.sanitized !== true || value.safety.rawOutputPersisted !== false || value.safety.rawArtifactPersisted !== false || value.safety.credentialsPersisted !== false || value.safety.tokensPersisted !== false || value.safety.cookiesPersisted !== false || value.safety.customerDataPersisted !== false) return false;
  if (value.sideEffects.productionOperations !== 0) return false;

  const expectedResult = derivedResult({
    source: value.sourceCommit,
    authorization: value.authorizationRecordRef,
    environment: value.environmentClass,
    nonProduction: value.nonProduction,
    components: value.components,
  });
  if (value.result !== expectedResult) return false;

  const serialized = JSON.stringify(value);
  if (/(?:postgres(?:ql)?:\/\/|https?:\/\/|Bearer\s+|BEGIN\s+(?:RSA|OPENSSH|EC)\s+PRIVATE\s+KEY|set-cookie)/iu.test(serialized)) return false;

  if (value.result === "PASS") {
    return value.runId !== "unknown"
      && value.executedAtUtc !== "unknown"
      && value.authorizationRecordRef !== "unknown"
      && SAFE_SOURCE_COMMIT.test(value.sourceCommit)
      && value.environmentClass === "staging"
      && value.nonProduction === true
      && STAGING_RELEASE_COMPONENTS.every((component) => value.components[component].result === "PASS");
  }

  return true;
}
