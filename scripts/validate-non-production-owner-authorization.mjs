import { fileURLToPath } from "node:url";
import path from "node:path";

// This validator reads only an allowlisted process-environment shape. It never
// prints, hashes, persists, or transmits the values behind the authorization
// references or scope flags.
export const OWNER_AUTHORIZATION_ENV_KEYS = Object.freeze([
  "AI_TEAM_AUTHORIZATION_RECORD_REF",
  "AI_TEAM_OWNER_REF",
  "AI_TEAM_SCOPE_REF",
  "AI_TEAM_NEW_EXECUTION_APPROVED",
  "AI_TEAM_NON_PRODUCTION",
  "AI_TEAM_FORBIDDEN_PROBE_REUSE",
  "AI_TEAM_PROVIDER_ENVIRONMENT",
]);

const OPAQUE_REFERENCE = /^opaque:[a-z0-9][a-z0-9._-]{7,79}$/u;
const PROVIDER_ENVIRONMENTS = new Set(["preview", "staging", "sandbox"]);
const FAILURE_REASONS = new Set([
  "authorization_missing",
  "authorization_invalid",
  "scope_invalid",
  "production_scope",
]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPresent(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function ownerAuthorizationAvailability(source = process.env) {
  const input = isRecord(source) ? source : {};
  return Object.freeze(Object.fromEntries(
    OWNER_AUTHORIZATION_ENV_KEYS.map((key) => [key, isPresent(input[key])]),
  ));
}

export function validateNonProductionOwnerAuthorization(source = process.env) {
  const input = isRecord(source) ? source : {};
  const availability = ownerAuthorizationAvailability(input);
  const missing = OWNER_AUTHORIZATION_ENV_KEYS.filter((key) => !availability[key]);
  if (missing.length > 0) {
    return Object.freeze({ ok: false, reason: "authorization_missing", availability });
  }

  const providerEnvironment = String(input.AI_TEAM_PROVIDER_ENVIRONMENT).trim().toLowerCase();
  if (providerEnvironment === "production") {
    return Object.freeze({ ok: false, reason: "production_scope", availability });
  }

  const referencesValid = [
    input.AI_TEAM_AUTHORIZATION_RECORD_REF,
    input.AI_TEAM_OWNER_REF,
    input.AI_TEAM_SCOPE_REF,
  ].every((value) => OPAQUE_REFERENCE.test(String(value).trim().toLowerCase()));
  if (!referencesValid) {
    return Object.freeze({ ok: false, reason: "authorization_invalid", availability });
  }

  if (
    !PROVIDER_ENVIRONMENTS.has(providerEnvironment)
    || String(input.AI_TEAM_NEW_EXECUTION_APPROVED).trim().toLowerCase() !== "true"
    || String(input.AI_TEAM_NON_PRODUCTION).trim().toLowerCase() !== "true"
    || String(input.AI_TEAM_FORBIDDEN_PROBE_REUSE).trim().toLowerCase() !== "false"
  ) {
    return Object.freeze({ ok: false, reason: "scope_invalid", availability });
  }

  return Object.freeze({ ok: true, reason: null, availability });
}

export class NonProductionOwnerAuthorizationError extends Error {
  constructor(reason, availability) {
    super("Non-Production owner authorization is required before external execution.");
    this.name = "NonProductionOwnerAuthorizationError";
    this.status = "OWNER_AUTHORIZATION_REQUIRED";
    this.reason = FAILURE_REASONS.has(reason) ? reason : "authorization_invalid";
    this.availability = availability;
  }
}

export function assertNonProductionOwnerAuthorization(source = process.env) {
  const result = validateNonProductionOwnerAuthorization(source);
  if (!result.ok) throw new NonProductionOwnerAuthorizationError(result.reason, result.availability);
  return result.availability;
}

export function formatOwnerAuthorizationResult(result) {
  if (result?.ok === true) {
    return "nonproduction_owner_authorization=PASS; non_production=true; new_execution_approved=true; forbidden_probe_reuse=false";
  }
  const reason = FAILURE_REASONS.has(result?.reason) ? result.reason : "authorization_invalid";
  return `nonproduction_owner_authorization=BLOCKED; reason=${reason}`;
}

export function runOwnerAuthorizationCli(source = process.env) {
  return validateNonProductionOwnerAuthorization(source);
}

const invokedScript = process.argv[1] ? path.resolve(process.argv[1]) : null;
const currentScript = fileURLToPath(import.meta.url);

if (invokedScript === currentScript) {
  const result = runOwnerAuthorizationCli();
  process.stdout.write(`${formatOwnerAuthorizationResult(result)}\n`);
  if (!result.ok) process.exitCode = 1;
}
