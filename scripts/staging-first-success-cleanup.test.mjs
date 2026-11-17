import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  MODES, createCleanupReceipt, formatCleanupSummary, parseMode, runStagingFirstSuccessCleanup, sanitizeCleanupResponse,
} from "./staging-first-success-cleanup.mjs";
import { ALIAS } from "./staging-first-success.mjs";

const sha = "a".repeat(40);
const env = {
  CELEBRATEDEAL_SOURCE_SHA: sha,
  CELEBRATEDEAL_DEPLOYMENT_HOST: "celebrate-deal-staging-abc123-a25814740s-projects.vercel.app",
  GITHUB_TOKEN: "gh",
  VERCEL_TOKEN: "vc",
  JOB_SECRET: "j".repeat(32),
};
const routeBody = {
  schemaVersion: "celebratedeal-staging-first-success-cleanup/v1", mode: "deactivate", result: "COMPLETED", retentionDays: 7,
  examined: 2, deactivated: 1, deleted: 0, alreadyDeactivated: 4, retained: 0, failed: 0, truncated: false,
  skipped: { financialRecords: 1, unexpectedMembership: 0, notRunnerVendor: 0, notEligible: 0 },
  affected: { lives: 1, registrations: 1, projects: 1, queuedEmailDeliveries: 2, ownerUsers: 0 },
  runIdPrefixes: { processed: ["0123abcd"], skipped: ["fedc9876"], failed: [] },
};

test("mode must be explicit; only the two fixed modes are accepted", () => {
  assert.deepEqual(MODES, ["deactivate", "delete"]);
  assert.equal(parseMode([], {}), null);
  assert.equal(parseMode([], { CELEBRATEDEAL_CLEANUP_MODE: "" }), null);
  assert.equal(parseMode(["--mode=deactivate"], {}), "deactivate");
  assert.equal(parseMode(["--mode=delete"], {}), "delete");
  assert.equal(parseMode([], { CELEBRATEDEAL_CLEANUP_MODE: "delete" }), "delete");
  assert.equal(parseMode(["--mode=deactivate"], { CELEBRATEDEAL_CLEANUP_MODE: "delete" }), "deactivate");
  for (const value of ["purge", "DELETE", "", "delete-all"]) assert.equal(parseMode([`--mode=${value}`], {}), null, value);
  assert.equal(parseMode([], { CELEBRATEDEAL_CLEANUP_MODE: "all" }), null);
});

test("an invalid mode, binding, lineage or alias stops before any request carries JOB_SECRET", async () => {
  const calls = [];
  const fetch = async (...args) => { calls.push(args); throw new Error("must not be called"); };
  assert.equal((await runStagingFirstSuccessCleanup(env, { fetch, mode: null })).reason, "INVALID_MODE");
  // Without --mode or CELEBRATEDEAL_CLEANUP_MODE nothing is sent either.
  assert.equal((await runStagingFirstSuccessCleanup(env, { fetch, verifyLineage: async () => true, verifyAlias: async () => true })).reason, "INVALID_MODE");
  assert.equal((await runStagingFirstSuccessCleanup({}, { fetch, mode: "deactivate" })).reason, "INVALID_BINDING");
  assert.equal((await runStagingFirstSuccessCleanup(env, { fetch, mode: "delete", verifyLineage: async () => false, verifyAlias: async () => true })).reason, "LINEAGE_NOT_VERIFIED");
  assert.equal((await runStagingFirstSuccessCleanup(env, { fetch, mode: "delete", verifyLineage: async () => true, verifyAlias: async () => false })).reason, "ALIAS_NOT_VERIFIED");
  assert.equal((await runStagingFirstSuccessCleanup(env, { fetch, mode: "deactivate", verifyLineage: async () => { throw new Error("x"); } })).reason, "BINDING_CHECK_FAILED");
  assert.deepEqual(calls, []);
});

test("one POST to the fixed alias route with the mode header and no body or query", async () => {
  const calls = [];
  const fetch = async (url, options) => { calls.push({ url, options }); return Response.json(routeBody); };
  const receipt = await runStagingFirstSuccessCleanup(env, { fetch, mode: "deactivate", verifyLineage: async () => true, verifyAlias: async () => true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `https://${ALIAS}/api/admin/ops/first-success/cleanup`);
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.body, undefined);
  assert.equal(calls[0].options.redirect, "manual");
  assert.deepEqual(calls[0].options.headers, {
    Authorization: `Bearer ${env.JOB_SECRET}`,
    "x-celebratedeal-source-sha": sha,
    "x-celebratedeal-first-success-cleanup-mode": "deactivate",
  });
  assert.equal(receipt.result, "COMPLETED");
  assert.equal(receipt.reason, "NONE");
  assert.equal(receipt.deactivated, 1);
  assert.equal(receipt.skipped.financialRecords, 1);
  assert.deepEqual(receipt.runIdPrefixes, { processed: ["0123abcd"], skipped: ["fedc9876"], failed: [] });
  assert.match(formatCleanupSummary(receipt), /^mode=deactivate result=COMPLETED reason=NONE examined=2 deactivated=1 deleted=0 already=4 retained=0 skipped=1 failed=0 truncated=false$/u);
});

test("route failures, a different mode or partial results never read as success", async () => {
  const run = (response, mode = "deactivate") => runStagingFirstSuccessCleanup(env, { fetch: async () => response, mode, verifyLineage: async () => true, verifyAlias: async () => true });
  assert.equal((await run(new Response("", { status: 404 }))).reason, "HTTP_404");
  assert.equal((await run(new Response("", { status: 401 }))).reason, "HTTP_401");
  assert.equal((await run(new Response("", { status: 418 }))).reason, "HTTP_OTHER");
  assert.equal((await run(new Response("not json", { status: 200 }))).reason, "INVALID_RESPONSE");
  assert.equal((await run(Response.json(routeBody), "delete")).reason, "INVALID_RESPONSE");
  const partial = await run(Response.json({ ...routeBody, result: "PARTIAL", failed: 1, runIdPrefixes: { processed: [], skipped: [], failed: ["0123abcd"] } }));
  assert.equal(partial.result, "PARTIAL");
  assert.equal(partial.reason, "VENDOR_FAILURES");
  assert.deepEqual(partial.runIdPrefixes.failed, ["0123abcd"]);
  const thrown = await runStagingFirstSuccessCleanup(env, { fetch: async () => { throw new Error("socket hang up at 10.0.0.1"); }, mode: "deactivate", verifyLineage: async () => true, verifyAlias: async () => true });
  assert.equal(thrown.reason, "REQUEST_FAILED");
});

test("the receipt keeps fixed keys, bounded counts and 8-hex prefixes only", () => {
  const clean = sanitizeCleanupResponse({
    ...routeBody,
    examined: -1, deleted: 1e12, email: "leak@example.test", vendorIds: ["v1"],
    skipped: { financialRecords: "1", extra: 4 },
    runIdPrefixes: { processed: ["0123456789abcdef01234567", "delivered+cdfs-owner", "ABCDEF12", "0123abcd"], skipped: "x", failed: null },
  }, "deactivate");
  assert.equal(clean.examined, 0);
  assert.equal(clean.deleted, 0);
  assert.deepEqual(clean.skipped, { financialRecords: 0, unexpectedMembership: 0, notRunnerVendor: 0, notEligible: 0 });
  assert.deepEqual(clean.runIdPrefixes, { processed: ["0123abcd"], skipped: [], failed: [] });
  const serialized = JSON.stringify({ ...createCleanupReceipt(sha, "delete"), ...clean });
  for (const forbidden of ["@", "leak", "vendorIds", "cdfs-owner", "http:", "https:", "token"]) assert.ok(!serialized.includes(forbidden), forbidden);
  assert.equal(createCleanupReceipt("not-a-sha", "delete").sourceSha, null);
  assert.equal(createCleanupReceipt(sha, "purge").mode, "INVALID");
});

test("runner workflow only deactivates after the journey; it never deletes", async () => {
  const workflow = await readFile(new URL("../.github/workflows/staging-first-success.yml", import.meta.url), "utf8");
  // The journey has its own timeout below the job's, so a hung journey still leaves time to deactivate.
  const jobTimeout = Number(/^ {4}timeout-minutes: (\d+)$/mu.exec(workflow)?.[1]);
  const journeyTimeout = Number(/- name: Walk the first-success journey through fixed staging\n\s+id: journey\n(?:\s+#[^\n]*\n)*\s+timeout-minutes: (\d+)\n/u.exec(workflow)?.[1]);
  const deactivateTimeout = Number(/- name: Deactivate synthetic first-success merchants\n\s+if: [^\n]+\n\s+timeout-minutes: (\d+)\n/u.exec(workflow)?.[1]);
  assert.ok(journeyTimeout > 0 && deactivateTimeout > 0, "journey and deactivate steps have their own timeouts");
  assert.ok(journeyTimeout + deactivateTimeout + 5 <= jobTimeout, "setup + journey + deactivate fit inside the job timeout");
  assert.match(workflow, /- name: Deactivate synthetic first-success merchants\n\s+if: \$\{\{ !cancelled\(\) && steps\.journey\.outcome != 'skipped' \}\}\n\s+timeout-minutes: \d+\n\s+env:\n\s+GITHUB_TOKEN: \$\{\{ github\.token \}\}\n\s+VERCEL_TOKEN: \$\{\{ secrets\.VERCEL_TOKEN \}\}\n\s+JOB_SECRET: \$\{\{ secrets\.JOB_SECRET \}\}\n\s+run: node scripts\/staging-first-success-cleanup\.mjs --mode=deactivate\n/u);
  assert.ok(workflow.indexOf("id: journey") < workflow.indexOf("Deactivate synthetic first-success merchants"));
  assert.doesNotMatch(workflow, /--mode=delete|CELEBRATEDEAL_CLEANUP_MODE/u);
  assert.match(workflow, /node --test scripts\/staging-first-success\.test\.mjs scripts\/staging-first-success-cleanup\.test\.mjs/u);
  assert.match(workflow, /celebratedeal-staging-first-success-cleanup-deactivate\.json/u);
});

test("cleanup workflow is manual, protected-master only, serialised with the runner and defaults to deactivate", async () => {
  const workflow = await readFile(new URL("../.github/workflows/staging-first-success-cleanup.yml", import.meta.url), "utf8");
  assert.match(workflow, /^on:\n {2}workflow_dispatch:/mu);
  assert.doesNotMatch(workflow, /^\s+(?:push|pull_request|schedule|workflow_run|merge_group):/mu);
  assert.match(workflow, /if: \$\{\{ github\.ref == 'refs\/heads\/master' && github\.ref_protected \}\}/u);
  assert.match(workflow, /environment: Preview – celebrate-deal-staging/u);
  assert.match(workflow, /concurrency:\n {2}group: staging-first-success\n {2}cancel-in-progress: false/u);
  assert.match(workflow, /mode:\n(?: {8}.+\n)*? {8}type: choice\n {8}default: deactivate\n {8}options:\n {10}- deactivate\n {10}- delete\n/u);
  assert.match(workflow, /CELEBRATEDEAL_CLEANUP_MODE: \$\{\{ inputs\.mode \}\}/u);
  assert.match(workflow, /- name: Clean up synthetic first-success merchants on fixed staging\n\s+timeout-minutes: \d+\n/u);
  assert.match(workflow, /permissions:\n {2}contents: read\n {2}deployments: read\n/u);
  assert.doesNotMatch(workflow, /buyer_order|PAYUNI_|payment-only|wp4-buyer|playwright install/u);
  // JOB_SECRET reaches only the cleanup step, after the contract test, lineage and alias proofs.
  assert.equal((workflow.match(/secrets\.JOB_SECRET/gu) ?? []).length, 1);
  const order = ["node --test scripts/staging-first-success-cleanup.test.mjs", "--verify-lineage", "--verify-alias", "secrets.JOB_SECRET", "run: node scripts/staging-first-success-cleanup.mjs"];
  for (let index = 1; index < order.length; index += 1) assert.ok(workflow.indexOf(order[index - 1]) < workflow.indexOf(order[index]), order[index]);
  assert.ok(workflow.indexOf("node --test scripts/staging-first-success-cleanup.test.mjs") < workflow.indexOf("secrets.VERCEL_TOKEN"));
  assert.match(workflow, /actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7\.0\.1/u);
  assert.match(workflow, /actions\/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7\.1\.0/u);
  assert.match(workflow, /actions\/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7\.0\.2/u);
  const script = await readFile(new URL("./staging-first-success-cleanup.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(script, /vendorId|@resend\.dev|body:/u);
});
