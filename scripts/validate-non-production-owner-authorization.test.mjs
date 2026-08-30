import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  formatOwnerAuthorizationResult,
  ownerAuthorizationAvailability,
  validateNonProductionOwnerAuthorization,
} from "./validate-non-production-owner-authorization.mjs";

const VALID_AUTHORIZATION = Object.freeze({
  AI_TEAM_AUTHORIZATION_RECORD_REF: "opaque:authorization-record",
  AI_TEAM_OWNER_REF: "opaque:release-owner",
  AI_TEAM_SCOPE_REF: "opaque:staging-payuni-sandbox",
  AI_TEAM_NEW_EXECUTION_APPROVED: "true",
  AI_TEAM_NON_PRODUCTION: "true",
  AI_TEAM_FORBIDDEN_PROBE_REUSE: "false",
  AI_TEAM_PROVIDER_ENVIRONMENT: "sandbox",
});

test("validates a non-Production owner authorization shape without exposing values", () => {
  const result = validateNonProductionOwnerAuthorization(VALID_AUTHORIZATION);
  assert.equal(result.ok, true);
  assert.equal(result.reason, null);
  assert.deepEqual(Object.values(result.availability), Array(7).fill(true));
  assert.equal(JSON.stringify(result).includes("authorization-record"), false);
  assert.equal(formatOwnerAuthorizationResult(result), "nonproduction_owner_authorization=PASS; non_production=true; new_execution_approved=true; forbidden_probe_reuse=false");
});

test("missing authorization fails closed before any external execution", () => {
  const result = validateNonProductionOwnerAuthorization({});
  assert.deepEqual(result.reason, "authorization_missing");
  assert.equal(result.ok, false);
  assert.equal(formatOwnerAuthorizationResult(result), "nonproduction_owner_authorization=BLOCKED; reason=authorization_missing");
});

test("availability reports only allowlisted booleans", () => {
  const availability = ownerAuthorizationAvailability({
    ...VALID_AUTHORIZATION,
    SECRET_VALUE: "must-not-be-returned",
  });
  assert.deepEqual(Object.keys(availability), [
    "AI_TEAM_AUTHORIZATION_RECORD_REF",
    "AI_TEAM_OWNER_REF",
    "AI_TEAM_SCOPE_REF",
    "AI_TEAM_NEW_EXECUTION_APPROVED",
    "AI_TEAM_NON_PRODUCTION",
    "AI_TEAM_FORBIDDEN_PROBE_REUSE",
    "AI_TEAM_PROVIDER_ENVIRONMENT",
  ]);
  assert.equal(JSON.stringify(availability).includes("SECRET_VALUE"), false);
  assert.equal(JSON.stringify(availability).includes("must-not-be-returned"), false);
});

test("opaque authorization, owner and scope references are required", () => {
  for (const key of [
    "AI_TEAM_AUTHORIZATION_RECORD_REF",
    "AI_TEAM_OWNER_REF",
    "AI_TEAM_SCOPE_REF",
  ]) {
    const result = validateNonProductionOwnerAuthorization({
      ...VALID_AUTHORIZATION,
      [key]: "holder:human-readable-name",
    });
    assert.equal(result.reason, "authorization_invalid", key);
  }
});

test("production provider scope is rejected before execution", () => {
  const result = validateNonProductionOwnerAuthorization({
    ...VALID_AUTHORIZATION,
    AI_TEAM_PROVIDER_ENVIRONMENT: "production",
  });
  assert.equal(result.reason, "production_scope");
});

test("approval, boundary and forbidden-probe flags are exact", () => {
  for (const [key, value] of [
    ["AI_TEAM_NEW_EXECUTION_APPROVED", "false"],
    ["AI_TEAM_NON_PRODUCTION", "false"],
    ["AI_TEAM_FORBIDDEN_PROBE_REUSE", "true"],
    ["AI_TEAM_PROVIDER_ENVIRONMENT", "unknown"],
  ]) {
    const result = validateNonProductionOwnerAuthorization({ ...VALID_AUTHORIZATION, [key]: value });
    assert.equal(result.reason, "scope_invalid", key);
  }
});

test("CLI output has fixed status and never echoes refs", () => {
  const script = fileURLToPath(new URL("./validate-non-production-owner-authorization.mjs", import.meta.url));
  const child = spawnSync(process.execPath, [script], {
    env: {
      PATH: process.env.PATH,
      AI_TEAM_AUTHORIZATION_RECORD_REF: "opaque:private-reference",
      AI_TEAM_OWNER_REF: "opaque:private-owner",
      AI_TEAM_SCOPE_REF: "opaque:private-scope",
      AI_TEAM_NEW_EXECUTION_APPROVED: "true",
      AI_TEAM_NON_PRODUCTION: "true",
      AI_TEAM_FORBIDDEN_PROBE_REUSE: "false",
      AI_TEAM_PROVIDER_ENVIRONMENT: "sandbox",
    },
    encoding: "utf8",
  });
  assert.equal(child.status, 0);
  assert.equal(child.stdout, "nonproduction_owner_authorization=PASS; non_production=true; new_execution_approved=true; forbidden_probe_reuse=false\n");
  assert.equal(child.stdout.includes("private"), false);
  assert.equal(child.stderr, "");
});

test("module has no write side effect when imported", () => {
  const source = readFileSync(new URL("./validate-non-production-owner-authorization.mjs", import.meta.url), "utf8");
  assert.equal(source.includes("fetch("), false);
  assert.equal(source.includes("writeFile"), false);
  assert.equal(source.includes("child_process"), false);
});
