import test from "node:test";
import assert from "node:assert/strict";
import { auditLoginProbeSource, CONTRACT, decideOutcome, parseInspect, validateReceipt } from "./wp191-staging-alias-rollback-rehearsal.mjs";

test("fixed targets are staging Preview allowlists", () => {
  assert.equal(CONTRACT.project, "celebrate-deal-staging");
  assert.notEqual(CONTRACT.latestId, CONTRACT.rollbackId);
  assert.equal(CONTRACT.alias.includes("staging"), true);
});

test("source audit accepts marker and reference-only action without DB or network", () => {
  const audit = auditLoginProbeSource({ page: "登入直播商務後台 <form action={loginAction}>", field: "getCsrfToken()", csrf: "cookies(); headers(); randomBytes(24)" });
  assert.equal(audit.qualified, true);
  assert.equal(audit.formReferenceOnly, true);
});

test("source audit rejects action invocation, DB, fetch and write calls", () => {
  assert.equal(auditLoginProbeSource({ page: "登入直播商務後台 <form action={loginAction}> loginAction()", field: "", csrf: "" }).qualified, false);
  assert.equal(auditLoginProbeSource({ page: "登入直播商務後台 <form action={loginAction}> getDb()", field: "", csrf: "" }).qualified, false);
  assert.equal(auditLoginProbeSource({ page: "登入直播商務後台 <form action={loginAction}>", field: "fetch()", csrf: "" }).qualified, false);
  assert.equal(auditLoginProbeSource({ page: "登入直播商務後台 <form action={loginAction}>", field: "", csrf: "writeFile()" }).qualified, false);
});

test("inspect parser requires exact project Preview READY and optional exact id", () => {
  const good = JSON.stringify({ id: CONTRACT.latestId, name: CONTRACT.project, target: "preview", readyState: "READY" });
  assert.equal(parseInspect(good, CONTRACT.latestId).ok, true);
  assert.equal(parseInspect(good, CONTRACT.rollbackId).ok, false);
  assert.equal(parseInspect(JSON.stringify({ id: CONTRACT.latestId, name: CONTRACT.project, target: "production", readyState: "READY" })).ok, false);
});

test("outcome requires both rollback and mandatory restore", () => {
  const base = { preflightPass: true, rollbackCommandOk: true, rollbackAliasMatched: true, rollbackLoginPass: true, restoreCommandOk: true, finalAliasMatched: true, finalMarkerPass: true, finalLoginPass: true, aliasMutations: 2 };
  assert.equal(decideOutcome(base).complete, true);
  assert.equal(decideOutcome({ ...base, rollbackLoginPass: false }).complete, false);
  assert.equal(decideOutcome({ ...base, finalMarkerPass: false }).restorePass, false);
  assert.equal(decideOutcome({ ...base, aliasMutations: 3 }).complete, false);
});

function probe(role) { return { role, attempted: true, status: 200, markerMatched: true, timestamp: "2026-08-04T00:00:00.000Z", rawBodyPersisted: false, headersPersisted: false, cookiesPersisted: false }; }

test("receipt enforces disclosure, budgets, restore and no persistence", () => {
  const receipt = {
    schemaVersion: "wp191-staging-alias-rollback-rehearsal/v1", status: "WP191_COMPLETE",
    historicalDisclosure: { healthHeadRequests: 2, possibleDatabaseSelectOne: 2, databaseWrites: 0, databaseLocks: 0 },
    postRemediation: { healthRequests: 0, databaseOperations: 0, payuniOperations: 0, deployments: 0, environmentMutations: 0, productionOperations: 0, dnsMutations: 0, gitMutations: 0 },
    preflight: { latestMarker: probe("LATEST_DIRECT"), latestLogin: probe("LATEST_DIRECT"), rollbackLogin: probe("ROLLBACK_DIRECT") },
    rollbackOutcome: { commandAttempts: 1, pass: true, login: probe("ROLLBACK_ALIAS") },
    restoreOutcome: { commandAttempts: 1, pass: true, marker: probe("LATEST_ALIAS"), login: probe("LATEST_ALIAS") },
    finalAliasIdentity: { proven: true }, attempts: { aliasInspections: 4, deploymentInspections: 2, latestMarkerGets: 2, loginGets: 4, aliasMutations: 2 },
    safety: { rawCliOutputPersisted: false, rawHtmlPersisted: false, csrfPersisted: false, headersPersisted: false, cookiesPersisted: false, secretRead: false },
  };
  assert.deepEqual(validateReceipt(receipt).errors, []);
  receipt.attempts.aliasMutations = 3;
  receipt.safety.csrfPersisted = true;
  assert.ok(validateReceipt(receipt).errors.includes("BUDGET"));
  assert.ok(validateReceipt(receipt).errors.includes("PERSISTENCE"));
});

test("rollback attempt without restore is invalid", () => {
  const receipt = {
    schemaVersion: "wp191-staging-alias-rollback-rehearsal/v1", status: "WP191_ROLLBACK_FAILED_RESTORED",
    historicalDisclosure: { healthHeadRequests: 2, possibleDatabaseSelectOne: 2, databaseWrites: 0, databaseLocks: 0 },
    postRemediation: { healthRequests: 0, databaseOperations: 0, payuniOperations: 0, deployments: 0, environmentMutations: 0, productionOperations: 0, dnsMutations: 0, gitMutations: 0 },
    preflight: { latestMarker: null, latestLogin: null, rollbackLogin: null }, rollbackOutcome: { commandAttempts: 1, login: null }, restoreOutcome: { commandAttempts: 0, marker: null, login: null },
    attempts: { aliasInspections: 0, deploymentInspections: 0, latestMarkerGets: 0, loginGets: 0, aliasMutations: 1 }, safety: { rawCliOutputPersisted: false, rawHtmlPersisted: false, csrfPersisted: false, headersPersisted: false, cookiesPersisted: false, secretRead: false },
  };
  assert.ok(validateReceipt(receipt).errors.includes("MANDATORY_RESTORE"));
});
