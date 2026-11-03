import assert from "node:assert/strict";
import os from "node:os";
import test from "node:test";
import { BACKUP_MIGRATION_TREE_SHA } from "./staging-backup-recovery-source.mjs";

import {
  ALIAS_ATTESTATION_FAILURES,
  BACKUP_SOURCE_SHA,
  STAGING_ALIAS_HOST,
  classifyPostgresFailure,
  classifyRestoreFailure,
  createInitialReceipt,
  filteredRestoreList,
  isolatedReadinessArgs,
  isolatedRestoreArgs,
  parseExtensionPlacements,
  readOnlySql,
  runSecureTask,
  sourceInventory,
  REQUIRED_CONFIG_KEYS,
  REQUIRED_SECRET_KEYS,
  validateInvocation,
  validateReceipt,
  verifyAliasAttestation,
  verifyDeployment,
  verifyDeploymentThroughAlias,
  verifyTrustedMigrationTree,
} from "./secure-staging-runner.mjs";

const sha = BACKUP_SOURCE_SHA;
const vercelCreator = Object.freeze({ login: "vercel[bot]", type: "Bot" });
const ownerCreator = Object.freeze({ login: "a25814740", type: "User" });
const actionsCreator = Object.freeze({ login: "github-actions[bot]", type: "Bot" });
const stagingEnvironment = "Preview – celebrate-deal-staging";
const deploymentsPath = "/repos/Forty-s-AI-Company/CelebrateDeal/deployments";

function actionsDeployment(id, index = id) {
  // Mirrors the record an Actions job bound to the staging environment leaves behind.
  return { id, sha, ref: "master", environment: stagingEnvironment, production_environment: false, creator: index % 2 === 0 ? ownerCreator : actionsCreator, payload: {} };
}

function vercelDeployment(id) {
  return { id, sha, ref: sha, environment: stagingEnvironment, production_environment: false, creator: vercelCreator };
}

// GitHub's real Link header: next+last on earlier pages, prev+first (no next, no last) on the final page.
function githubLink(page, lastPage) {
  const link = (target, rel) => `<https://api.github.com${deploymentsPath}?sha=${sha}&ref=${sha}&per_page=100&page=${target}>; rel="${rel}"`;
  const entries = [];
  if (page > 1) entries.push(link(page - 1, "prev"));
  if (page < lastPage) entries.push(link(page + 1, "next"), link(lastPage, "last"));
  if (page > 1) entries.push(link(1, "first"));
  return entries.length > 0 ? { Link: entries.join(", ") } : {};
}

// Fake GitHub: the deployments listing honours the ref query parameter like the real API.
function honoringRef(fetchImpl) {
  return async (input, init) => {
    const response = await fetchImpl(input, init);
    const request = new URL(String(input));
    if (request.pathname !== deploymentsPath || response.status !== 200) return response;
    const ref = request.searchParams.get("ref");
    const body = await response.json();
    const filtered = Array.isArray(body) ? body.filter((item) => item?.ref === ref) : body;
    return new Response(JSON.stringify(filtered), { status: response.status, headers: response.headers });
  };
}

function verifyThroughGitHub(source, fetchImpl) {
  return verifyDeployment(source, honoringRef(fetchImpl));
}

function environment() {
  return {
    STAGING_DATABASE_URL: ["postgresql:", "", "postgres.projectref:fixture@aws-0-ap-northeast-1.pooler.supabase.com:5432", "postgres"].join("/"),
    GITHUB_TOKEN: "present",
    NEXT_PUBLIC_SUPABASE_URL: "https://projectref.supabase.co",
    CELEBRATEDEAL_SOURCE_SHA: sha,
    CELEBRATEDEAL_DEPLOYMENT_HOST: "safe-preview.vercel.app",
    STAGING_BACKUP_AGE_RECIPIENT: `age1${"a".repeat(58)}`,
    RUNNER_TEMP: os.tmpdir(),
  };
}

function completePassReceipt() {
  // The current staging snapshot has 58 applied migrations while this RC contains 79.
  const receipt = createInitialReceipt(sha);
  receipt.result = "PASS";
  receipt.lineage = { deploymentReads: 2, deploymentMatched: true, sourceMatched: true, preview: true, ready: true, healthStatus: 200, noRedirect: true, deploymentDigest: `sha256:${"a".repeat(64)}` };
  receipt.database = { connectionAttempts: 1, firstTransactionReadOnly: true, identityMatched: true, readQueries: 6, disconnected: true };
  receipt.migration = { expectedCount: sourceInventory(sha, undefined, BACKUP_MIGRATION_TREE_SHA).size, appliedCount: 58, unresolvedFailedCount: 0, rollbackEntryCount: 1, completedCounterpartCount: 1, exactChecksumCount: 57, formatVarianceCount: 1, unknownMismatchCount: 0, status: "BACKUP_READY_MIGRATIONS_PENDING" };
  receipt.backup = { attempts: 1, result: "PASS", byteBucket: "1_to_10mib", digest: `sha256:${"b".repeat(64)}` };
  receipt.restore = { attempts: 1, result: "PASS", migrationCount: 58, schemaMatched: true, extensionsMatched: true, aggregateMatched: true, isolated: true };
  receipt.retention = { status: "ENCRYPTED", archiveDigest: `sha256:${"c".repeat(64)}`, recipientDigest: `sha256:${"d".repeat(64)}`, recoverability: "NOT_PROVEN", migrationAuthorization: "BLOCKED" };
  receipt.sideEffects.backupWrites = 1;
  receipt.sideEffects.isolatedRestoreWrites = 1;
  return receipt;
}

test("only the fixed WP2 task and complete allowlisted bindings are accepted", () => {
  const source = environment();
  assert.equal(validateInvocation("wp2-readonly-restore", source).ok, true);
  assert.equal(validateInvocation("arbitrary-command", source).reason, "TASK_NOT_ALLOWLISTED");
  assert.equal(validateInvocation("wp2-readonly-restore", { ...source, CELEBRATEDEAL_SOURCE_SHA: "a".repeat(40) }).reason, "SOURCE_SHA_INVALID");
  assert.equal(validateInvocation("wp2-readonly-restore", { ...source, STAGING_BACKUP_AGE_RECIPIENT: "invalid" }).reason, "STAGING_RECIPIENT_INVALID");
  for (const key of [...REQUIRED_SECRET_KEYS, ...REQUIRED_CONFIG_KEYS]) {
    assert.equal(validateInvocation("wp2-readonly-restore", { ...source, [key]: "" }).ok, false, key);
  }
});

test("backup manifest is read from the fixed RC commit", () => {
  const manifest = sourceInventory(sha, undefined, BACKUP_MIGRATION_TREE_SHA);
  assert.equal(manifest.size, 79);
  assert.throws(() => sourceInventory("a".repeat(40)), /SOURCE_COMMIT_UNAVAILABLE|SOURCE_MIGRATION_COUNT_INVALID/u);
});

test("cross-project database identity and non-Preview hosts fail closed", () => {
  const source = environment();
  assert.equal(validateInvocation("wp2-readonly-restore", { ...source, CELEBRATEDEAL_DEPLOYMENT_HOST: "staging.example.net" }).reason, "DEPLOYMENT_HOST_INVALID");
  const wrongProject = ["postgresql:", "", "postgres.other:fixture@aws-0.pooler.supabase.com:5432", "postgres"].join("/");
  assert.equal(validateInvocation("wp2-readonly-restore", { ...source, STAGING_DATABASE_URL: wrongProject }).reason, "STAGING_DATABASE_IDENTITY_INVALID");
});

test("deployment verification requires one exact non-production successful Preview", async () => {
  const source = environment();
  const responses = [
    new Response(JSON.stringify([{ id: 42, sha, ref: sha, environment: "Preview – celebrate-deal-staging", production_environment: false, creator: vercelCreator }]), { status: 200 }),
    new Response(JSON.stringify([{ state: "success", environment_url: "https://safe-preview.vercel.app" }]), { status: 200 }),
  ];
  const result = await verifyThroughGitHub(source, async () => responses.shift());
  assert.equal(result.sourceMatched, true);
  assert.equal(result.reads, 2);
  const productionResponses = [new Response(JSON.stringify([{ id: 42, sha, ref: sha, environment: "Preview – celebrate-deal-staging", production_environment: true, creator: vercelCreator }]), { status: 200 })];
  await assert.rejects(verifyThroughGitHub(source, async () => productionResponses.shift()), /GITHUB_DEPLOYMENT_AMBIGUOUS/u);
});

test("deployment verification reads every candidate and ignores latest failure records", async () => {
  const source = environment();
  const requests = [];
  const responses = [
    new Response(JSON.stringify([
      { id: 41, sha, ref: sha, environment: "Preview – celebrate-deal-staging", production_environment: false, creator: vercelCreator },
      { id: 42, sha, ref: sha, environment: "Preview – celebrate-deal-staging", production_environment: false, creator: vercelCreator },
    ]), { status: 200 }),
    new Response(JSON.stringify([{ state: "failure", environment_url: "https://safe-preview.vercel.app" }]), { status: 200 }),
    new Response(JSON.stringify([{ state: "success", environment_url: "https://safe-preview.vercel.app/" }]), { status: 200 }),
  ];
  const result = await verifyThroughGitHub(source, async (input) => {
    requests.push(new URL(String(input)));
    return responses.shift();
  });

  assert.equal(result.deploymentMatched, true);
  assert.equal(result.reads, 3);
  assert.equal(requests.length, 3);
  assert.equal(requests[0].searchParams.get("per_page"), "100");
  assert.deepEqual(requests.slice(1).map((request) => [request.pathname, request.searchParams.get("per_page")]), [
    ["/repos/Forty-s-AI-Company/CelebrateDeal/deployments/41/statuses", "1"],
    ["/repos/Forty-s-AI-Company/CelebrateDeal/deployments/42/statuses", "1"],
  ]);
  assert.doesNotMatch(JSON.stringify(result), /https?:\/\//iu);
});

test("deployment verification follows a Link-header page for a unique exact-host success", async () => {
  const source = environment();
  const requests = [];
  const pageOne = [
    { id: 41, sha, ref: sha, environment: "Preview – celebrate-deal-staging", production_environment: false, creator: vercelCreator },
    ...Array.from({ length: 99 }, (_, index) => ({ id: 100 + index, sha: "f".repeat(40), ref: sha, environment: "Preview – celebrate-deal-staging", production_environment: false, creator: vercelCreator })),
  ];
  const responses = [
    new Response(JSON.stringify(pageOne), {
      status: 200,
      headers: { Link: '<https://api.github.com/repos/Forty-s-AI-Company/CelebrateDeal/deployments?page=2>; rel="next"' },
    }),
    new Response(JSON.stringify([{ state: "failure", environment_url: "https://safe-preview.vercel.app" }]), { status: 200 }),
    new Response(JSON.stringify([{ id: 42, sha, ref: sha, environment: "Preview – celebrate-deal-staging", production_environment: false, creator: vercelCreator }]), { status: 200 }),
    new Response(JSON.stringify([{ state: "success", target_url: "https://safe-preview.vercel.app/" }]), { status: 200 }),
  ];
  const result = await verifyThroughGitHub(source, async (input) => {
    requests.push(new URL(String(input)));
    return responses.shift();
  });

  assert.equal(result.deploymentMatched, true);
  assert.equal(result.reads, 4);
  assert.deepEqual(requests.filter((request) => request.pathname.endsWith("/deployments")).map((request) => request.searchParams.get("page")), ["1", "2"]);
});

test("deployment verification rejects a malformed Link header before accepting page-one success", async () => {
  const source = environment();
  const pageOne = [
    { id: 42, sha, ref: sha, environment: "Preview – celebrate-deal-staging", production_environment: false, creator: vercelCreator },
    ...Array.from({ length: 99 }, (_, index) => ({ id: 300 + index, sha: "f".repeat(40), ref: sha, environment: "Preview – celebrate-deal-staging", production_environment: false, creator: vercelCreator })),
  ];
  const requests = [];
  await assert.rejects(
    verifyThroughGitHub(source, async (input) => {
      requests.push(new URL(String(input)));
      return new Response(JSON.stringify(pageOne), { status: 200, headers: { Link: "malformed-pagination" } });
    }),
    /GITHUB_DEPLOYMENT_PAGINATION_INVALID/u,
  );
  assert.equal(requests.length, 1);
});

test("deployment verification accepts a valid terminal Link header without next", async () => {
  const source = environment();
  const requests = [];
  const responses = [
    new Response(JSON.stringify([{ id: 42, sha, ref: sha, environment: "Preview – celebrate-deal-staging", production_environment: false, creator: vercelCreator }]), {
      status: 200,
      headers: { Link: '<https://api.github.com/repos/Forty-s-AI-Company/CelebrateDeal/deployments?page=1>; rel="last"' },
    }),
    new Response(JSON.stringify([{ state: "success", environment_url: "https://safe-preview.vercel.app" }]), { status: 200 }),
  ];
  const result = await verifyThroughGitHub(source, async (input) => {
    requests.push(new URL(String(input)));
    return responses.shift();
  });
  assert.equal(result.deploymentMatched, true);
  assert.equal(result.reads, 2);
  assert.deepEqual(requests.map((request) => request.searchParams.get("page")), ["1", null]);
});

test("deployment verification reads across full pages before rejecting multiple exact-host successes", async () => {
  const source = environment();
  const requests = [];
  const pageOne = [
    { id: 41, sha, ref: sha, environment: "Preview – celebrate-deal-staging", production_environment: false, creator: vercelCreator },
    ...Array.from({ length: 99 }, (_, index) => ({ id: 200 + index, sha, ref: sha, environment: "Preview – celebrate-deal-staging", production_environment: true, creator: vercelCreator })),
  ];
  const responses = [
    new Response(JSON.stringify(pageOne), { status: 200 }),
    new Response(JSON.stringify([{ state: "success", environment_url: "https://safe-preview.vercel.app" }]), { status: 200 }),
    new Response(JSON.stringify([{ id: 42, sha, ref: sha, environment: "Preview – celebrate-deal-staging", production_environment: false, creator: vercelCreator }]), { status: 200 }),
    new Response(JSON.stringify([{ state: "success", target_url: "https://safe-preview.vercel.app/" }]), { status: 200 }),
  ];
  await assert.rejects(
    verifyThroughGitHub(source, async (input) => {
      requests.push(new URL(String(input)));
      return responses.shift();
    }),
    /GITHUB_DEPLOYMENT_AMBIGUOUS/u,
  );
  assert.equal(requests.length, 4);
  assert.deepEqual(requests.filter((request) => request.pathname.endsWith("/deployments")).map((request) => request.searchParams.get("page")), ["1", "2"]);
});

test("deployment verification fails closed when pagination exhausts the total GitHub read budget", async () => {
  const source = environment();
  const requests = [];
  await assert.rejects(
    verifyThroughGitHub(source, async (input) => {
      const request = new URL(String(input));
      requests.push(request);
      if (request.pathname.endsWith("/statuses")) {
        return new Response(JSON.stringify([{ state: "failure", environment_url: "https://safe-preview.vercel.app" }]), { status: 200 });
      }
      const page = Number(request.searchParams.get("page"));
      // Full 100-item pages: 10 Vercel records each; the padded Actions records (ref "master") are dropped by the ref filter.
      const deployments = Array.from({ length: 100 }, (_, index) => (index < 10 ? { id: page * 1000 + index, sha, ref: sha, environment: "Preview – celebrate-deal-staging", production_environment: false, creator: vercelCreator } : actionsDeployment(page * 1000 + index, index)));
      return new Response(JSON.stringify(deployments), {
        status: 200,
        headers: { Link: `<https://api.github.com/repos/Forty-s-AI-Company/CelebrateDeal/deployments?page=${page + 1}>; rel="next"` },
      });
    }),
    /GITHUB_DEPLOYMENT_READ_BUDGET_EXHAUSTED/u,
  );
  assert.equal(requests.length, 20);
  assert.equal(requests.filter((request) => request.pathname.endsWith("/deployments")).length, 2);
  assert.equal(requests.filter((request) => request.pathname.endsWith("/statuses")).length, 18);
});

test("deployment verification fails closed with zero successful exact-host candidates", async () => {
  const source = environment();
  const responses = [
    new Response(JSON.stringify([{ id: 42, sha, ref: sha, environment: "Preview – celebrate-deal-staging", production_environment: false, creator: vercelCreator }]), { status: 200 }),
    new Response(JSON.stringify([{ state: "failure", environment_url: "https://safe-preview.vercel.app" }]), { status: 200 }),
  ];
  await assert.rejects(
    verifyThroughGitHub(source, async () => responses.shift()),
    /GITHUB_DEPLOYMENT_LINEAGE_MISMATCH/u,
  );
});

test("deployment verification fails closed with multiple successful exact-host candidates", async () => {
  const source = environment();
  const responses = [
    new Response(JSON.stringify([
      { id: 41, sha, ref: sha, environment: "Preview – celebrate-deal-staging", production_environment: false, creator: vercelCreator },
      { id: 42, sha, ref: sha, environment: "Preview – celebrate-deal-staging", production_environment: false, creator: vercelCreator },
    ]), { status: 200 }),
    new Response(JSON.stringify([{ state: "success", environment_url: "https://safe-preview.vercel.app" }]), { status: 200 }),
    new Response(JSON.stringify([{ state: "success", target_url: "https://safe-preview.vercel.app/" }]), { status: 200 }),
  ];
  await assert.rejects(
    verifyThroughGitHub(source, async () => responses.shift()),
    /GITHUB_DEPLOYMENT_AMBIGUOUS/u,
  );
});

test("deployment verification accepts GitHub target_url and rejects conflicting status URLs", async () => {
  const source = environment();
  const targetUrlResponses = [
    new Response(JSON.stringify([{ id: 42, sha, ref: sha, environment: "Preview – celebrate-deal-staging", production_environment: false, creator: vercelCreator }]), { status: 200 }),
    new Response(JSON.stringify([{ state: "success", target_url: "https://safe-preview.vercel.app" }]), { status: 200 }),
  ];
  const result = await verifyThroughGitHub(source, async () => targetUrlResponses.shift());
  assert.equal(result.deploymentMatched, true);

  const conflictingResponses = [
    new Response(JSON.stringify([{ id: 42, sha, ref: sha, environment: "Preview – celebrate-deal-staging", production_environment: false, creator: vercelCreator }]), { status: 200 }),
    new Response(JSON.stringify([{
      state: "success",
      environment_url: "https://safe-preview.vercel.app",
      target_url: "https://different-preview.vercel.app",
    }]), { status: 200 }),
  ];
  await assert.rejects(
    verifyThroughGitHub(source, async () => conflictingResponses.shift()),
    /GITHUB_DEPLOYMENT_LINEAGE_MISMATCH/u,
  );
});

// Fake GitHub listing over a flat, newest-first record set. honorRef=false simulates an API that ignores ref.
function fakeDeploymentsApi(records, statusesById, requests, { honorRef = true } = {}) {
  return async (input) => {
    const request = new URL(String(input));
    requests.push(request);
    if (request.pathname.endsWith("/statuses")) {
      const id = Number(request.pathname.split("/").at(-2));
      return new Response(JSON.stringify(statusesById[id] ?? [{ state: "failure" }]), { status: 200 });
    }
    const ref = request.searchParams.get("ref");
    const matching = honorRef ? records.filter((item) => item.ref === ref) : records;
    const pageSize = Number(request.searchParams.get("per_page"));
    const page = Number(request.searchParams.get("page"));
    const lastPage = Math.max(1, Math.ceil(matching.length / pageSize));
    return new Response(JSON.stringify(matching.slice((page - 1) * pageSize, page * pageSize)), { status: 200, headers: githubLink(page, lastPage) });
  };
}

const exactHostSuccess = Object.freeze([{ state: "success", environment_url: "https://safe-preview.vercel.app" }]);
const actionsRecords = (count, firstId = 900) => Array.from({ length: count }, (_, index) => actionsDeployment(firstId + index, index));
const listRequests = (requests) => requests.filter((request) => request.pathname === deploymentsPath);
const statusRequests = (requests) => requests.filter((request) => request.pathname.endsWith("/statuses"));

test("deployment verification lists by sha, exact source ref and environment so Actions records are never returned", async () => {
  const source = environment();
  const requests = [];
  // 2026-11-02 shape scaled to the new page size: many Actions records (ref "master"), the Vercel record (ref = sha) last.
  const records = [...actionsRecords(180), vercelDeployment(7464859261)];
  const statusesById = Object.fromEntries(records.map((item) => [item.id, exactHostSuccess]));

  const result = await verifyDeployment(source, fakeDeploymentsApi(records, statusesById, requests));

  assert.equal(result.deploymentMatched, true);
  assert.equal(result.reads, 2);
  assert.equal(listRequests(requests).length, 1);
  for (const request of listRequests(requests)) {
    assert.equal(request.searchParams.get("sha"), sha);
    assert.equal(request.searchParams.get("ref"), sha);
    assert.equal(request.searchParams.getAll("ref").length, 1);
    assert.equal(request.searchParams.get("environment"), stagingEnvironment);
    assert.equal(request.searchParams.get("per_page"), "100");
  }
  assert.deepEqual(statusRequests(requests).map((request) => request.pathname), [`${deploymentsPath}/7464859261/statuses`]);
});

test("deployment verification still skips Actions records when the API ignores ref, across pages", async () => {
  const source = environment();
  const requests = [];
  const records = [...actionsRecords(180), vercelDeployment(7464859261)];
  // Even Actions records whose status points at the exact host must not be read or trusted.
  const statusesById = Object.fromEntries(records.map((item) => [item.id, exactHostSuccess]));

  const result = await verifyDeployment(source, fakeDeploymentsApi(records, statusesById, requests, { honorRef: false }));

  assert.equal(result.deploymentMatched, true);
  assert.equal(result.host, "safe-preview.vercel.app");
  assert.equal(result.reads, 3);
  assert.deepEqual(listRequests(requests).map((request) => request.searchParams.get("page")), ["1", "2"]);
  assert.deepEqual(statusRequests(requests).map((request) => request.pathname), [`${deploymentsPath}/7464859261/statuses`]);
});

test("deployment verification reports a missing Vercel record distinctly and never reads Actions statuses", async () => {
  const source = environment();
  const actions = actionsRecords(180);
  const statusesById = Object.fromEntries(actions.map((item) => [item.id, exactHostSuccess]));

  // An API that ignores ref returns only Actions records: the creator filter yields the dedicated error.
  const ignoringRequests = [];
  await assert.rejects(
    verifyDeployment(source, fakeDeploymentsApi(actions, statusesById, ignoringRequests, { honorRef: false })),
    /GITHUB_DEPLOYMENT_NO_VERCEL_CANDIDATE/u,
  );
  assert.equal(statusRequests(ignoringRequests).length, 0);
  assert.equal(ignoringRequests.length, 2);

  // With ref honoured nothing is listed at all, which keeps the pre-existing error.
  const honouringRequests = [];
  await assert.rejects(verifyDeployment(source, fakeDeploymentsApi(actions, statusesById, honouringRequests)), /GITHUB_DEPLOYMENT_AMBIGUOUS/u);
  assert.equal(statusRequests(honouringRequests).length, 0);
  await assert.rejects(verifyDeployment(source, fakeDeploymentsApi([], {}, [])), /GITHUB_DEPLOYMENT_AMBIGUOUS/u);
});

test("deployment verification does not trust a vercel[bot] login without the Bot creator type", async () => {
  const source = environment();
  const requests = [];
  const spoofed = { ...vercelDeployment(42), creator: { login: "vercel[bot]", type: "User" } };
  const missingCreator = { id: 43, sha, ref: sha, environment: stagingEnvironment, production_environment: false };
  await assert.rejects(
    verifyDeployment(source, fakeDeploymentsApi([spoofed, missingCreator], { 42: exactHostSuccess, 43: exactHostSuccess }, requests)),
    /GITHUB_DEPLOYMENT_NO_VERCEL_CANDIDATE/u,
  );
  assert.equal(statusRequests(requests).length, 0);
});

test("deployment verification rejects a Vercel record whose host does not match", async () => {
  const source = environment();
  const records = [...actionsRecords(180), vercelDeployment(7464859261)];
  const statusesById = { 7464859261: [{ state: "success", environment_url: "https://other-preview.vercel.app" }] };
  await assert.rejects(verifyDeployment(source, fakeDeploymentsApi(records, statusesById, [])), /GITHUB_DEPLOYMENT_LINEAGE_MISMATCH/u);
  await assert.rejects(verifyDeployment(source, fakeDeploymentsApi(records, statusesById, [], { honorRef: false })), /GITHUB_DEPLOYMENT_LINEAGE_MISMATCH/u);
});

test("deployment verification rejects two matching Vercel records as ambiguous", async () => {
  const source = environment();
  const records = [vercelDeployment(41), ...actionsRecords(180), vercelDeployment(42)];
  const statusesById = { 41: exactHostSuccess, 42: [{ state: "success", target_url: "https://safe-preview.vercel.app/" }] };
  for (const honorRef of [true, false]) {
    const requests = [];
    await assert.rejects(verifyDeployment(source, fakeDeploymentsApi(records, statusesById, requests, { honorRef })), /GITHUB_DEPLOYMENT_AMBIGUOUS/u);
    assert.equal(statusRequests(requests).length, 2);
    assert.equal(listRequests(requests).length, honorRef ? 1 : 2);
  }
});

test("deployment verification counts a Vercel record repeated across pages once, but still rejects a distinct second match", async () => {
  const source = environment();
  // A record created between page reads shifts the listing, so page 2 starts with page 1's last item.
  const pageOne = [...actionsRecords(99), vercelDeployment(42)];
  const shiftedPageTwo = (extra) => [vercelDeployment(42), ...extra];
  const fetchFor = (pageTwo, statusesById, requests) => async (input) => {
    const request = new URL(String(input));
    requests.push(request);
    if (request.pathname.endsWith("/statuses")) {
      const id = Number(request.pathname.split("/").at(-2));
      return new Response(JSON.stringify(statusesById[id] ?? [{ state: "failure" }]), { status: 200 });
    }
    const page = Number(request.searchParams.get("page"));
    return new Response(JSON.stringify(page === 1 ? pageOne : pageTwo), { status: 200, headers: githubLink(page, 2) });
  };

  const requests = [];
  const result = await verifyDeployment(source, fetchFor(shiftedPageTwo(actionsRecords(5, 5000)), { 42: exactHostSuccess }, requests));
  assert.equal(result.deploymentMatched, true);
  assert.equal(result.reads, 3);
  assert.deepEqual(statusRequests(requests).map((request) => request.pathname), [`${deploymentsPath}/42/statuses`]);

  const ambiguousRequests = [];
  await assert.rejects(
    verifyDeployment(source, fetchFor(shiftedPageTwo([vercelDeployment(43)]), { 42: exactHostSuccess, 43: exactHostSuccess }, ambiguousRequests)),
    /GITHUB_DEPLOYMENT_AMBIGUOUS/u,
  );
  assert.deepEqual(statusRequests(ambiguousRequests).map((request) => request.pathname), [`${deploymentsPath}/42/statuses`, `${deploymentsPath}/43/statuses`]);
});

test("deployment verification reaches a Vercel record on the last allowed page", async () => {
  const source = environment();
  const requests = [];
  const records = [...actionsRecords(999, 10000), vercelDeployment(7464859261)];
  const result = await verifyDeployment(source, fakeDeploymentsApi(records, { 7464859261: exactHostSuccess }, requests, { honorRef: false }));
  assert.equal(result.deploymentMatched, true);
  assert.equal(result.reads, 11);
  assert.equal(listRequests(requests).length, 10);
});

test("deployment verification accepts GitHub's final-page Link shape but rejects terminal pages without prev or last", async () => {
  const source = environment();
  const actions = actionsRecords(100);
  const finalPage = [vercelDeployment(42)];
  const result = await verifyDeployment(source, fakeDeploymentsApi([...actions, ...finalPage], { 42: exactHostSuccess }, [], { honorRef: false }));
  assert.equal(result.deploymentMatched, true);

  for (const terminalLink of [
    `<https://api.github.com${deploymentsPath}?page=1>; rel="first"`,
    `<https://api.github.com${deploymentsPath}?page=3>; rel="prev", <https://api.github.com${deploymentsPath}?page=1>; rel="first"`,
    `<https://api.github.com${deploymentsPath}?page=3>; rel="last", <https://api.github.com${deploymentsPath}?page=1>; rel="prev"`,
  ]) {
    const responses = [
      new Response(JSON.stringify(actions), { status: 200, headers: githubLink(1, 2) }),
      new Response(JSON.stringify(finalPage), { status: 200, headers: { Link: terminalLink } }),
    ];
    await assert.rejects(verifyDeployment(source, async () => responses.shift()), /GITHUB_DEPLOYMENT_PAGINATION_INVALID/u, terminalLink);
  }
});

test("deployment verification stops paginating at the list page limit", async () => {
  const source = environment();
  const requests = [];
  const records = [...actionsRecords(1100, 20000), vercelDeployment(7464859261)];
  await assert.rejects(
    verifyDeployment(source, fakeDeploymentsApi(records, { 7464859261: exactHostSuccess }, requests, { honorRef: false })),
    /GITHUB_DEPLOYMENT_PAGE_LIMIT_EXHAUSTED/u,
  );
  assert.equal(requests.length, 10);
  assert.equal(statusRequests(requests).length, 0);
});

test("squash-merged sources require an exact protected migration tree", () => {
  const trustedTree = "a".repeat(40);
  const matchingSpawn = (_command, args) => {
    const key = args.join(" ");
    if (key.startsWith("cat-file -e ")) return { status: 0, stdout: "" };
    if (key.startsWith("merge-base --is-ancestor ")) return { status: 1, stdout: "" };
    if (key === `rev-parse ${sha}:prisma/migrations` || key === "rev-parse HEAD:prisma/migrations") {
      return { status: 0, stdout: `${trustedTree}\n` };
    }
    return { status: 1, stdout: "" };
  };
  assert.deepEqual(verifyTrustedMigrationTree(sha, matchingSpawn), { mode: "squash-equivalent" });

  const mismatchedSpawn = (_command, args) => {
    const result = matchingSpawn(_command, args);
    return args.join(" ") === "rev-parse HEAD:prisma/migrations"
      ? { status: 0, stdout: `${"b".repeat(40)}\n` }
      : result;
  };
  assert.throws(() => verifyTrustedMigrationTree(sha, mismatchedSpawn), /SOURCE_MIGRATION_TREE_UNTRUSTED/u);
});

test("retained recovery pins its immutable source tree independently of future HEAD", () => {
  const pinnedTree = "8204bf3ce05a309035f55b2f90aaffb18aed05c8";
  const pinnedSpawn = (_command, args) => {
    const key = args.join(" ");
    if (key.startsWith("cat-file -e ")) return { status: 0, stdout: "" };
    if (key === `rev-parse ${sha}:prisma/migrations`) return { status: 0, stdout: `${pinnedTree}\n` };
    throw new Error(`Unexpected current-tree read: ${key}`);
  };
  assert.deepEqual(verifyTrustedMigrationTree(sha, pinnedSpawn, pinnedTree), { mode: "pinned-recovery" });
  assert.throws(() => verifyTrustedMigrationTree(sha, pinnedSpawn, "b".repeat(40)), /PINNED_SOURCE_TREE_MISMATCH/u);
  assert.throws(() => verifyTrustedMigrationTree("a".repeat(40), pinnedSpawn, pinnedTree), /PINNED_SOURCE_INVALID/u);
  assert.equal(sourceInventory(sha, undefined, pinnedTree).size, 79);
});

test("source queries begin an explicit read-only transaction without startup PGOPTIONS", () => {
  const wrapped = readOnlySql("SELECT current_setting('transaction_read_only')");
  assert.equal(wrapped, "BEGIN READ ONLY; SELECT current_setting('transaction_read_only'); COMMIT;");
  assert.throws(() => readOnlySql("UPDATE public.example SET value = 1"), /SOURCE_QUERY_NOT_READ_ONLY/u);
});

test("database stderr is reduced to fixed sanitized failure categories", () => {
  assert.equal(classifyPostgresFailure("password authentication failed for user [redacted]"), "DATABASE_AUTHENTICATION_FAILED");
  assert.equal(classifyPostgresFailure("connection timed out"), "DATABASE_NETWORK_FAILED");
  assert.equal(classifyPostgresFailure("unsupported startup parameter: options"), "DATABASE_POOLER_STARTUP_REJECTED");
  assert.equal(classifyPostgresFailure("unrecognized provider response"), "DATABASE_CONNECTION_OR_QUERY_FAILED");
  for (const sample of ["credential=value", "postgresql://example", "user@example.test"]) {
    assert.match(classifyPostgresFailure(sample), /^[A-Z0-9_]+$/u);
  }
});

test("restore stderr is reduced to fixed sanitized failure categories", () => {
  assert.equal(classifyRestoreFailure('error: role "supabase_admin" does not exist'), "ISOLATED_RESTORE_ROLE_DEPENDENCY");
  assert.equal(classifyRestoreFailure('error: schema "auth" does not exist'), "ISOLATED_RESTORE_SCHEMA_DEPENDENCY");
  assert.equal(classifyRestoreFailure("function auth.uid() does not exist"), "ISOLATED_RESTORE_AUTH_FUNCTION_DEPENDENCY");
  assert.equal(classifyRestoreFailure("function public.uuid_generate_v4() does not exist"), "ISOLATED_RESTORE_UUID_OSSP_DEPENDENCY");
  assert.equal(classifyRestoreFailure("function extensions.digest(text, text) does not exist"), "ISOLATED_RESTORE_PGCRYPTO_DEPENDENCY");
  assert.equal(classifyRestoreFailure("operator class extensions.gin_trgm_ops does not exist"), "ISOLATED_RESTORE_PG_TRGM_DEPENDENCY");
  assert.equal(classifyRestoreFailure("type extensions.vector does not exist"), "ISOLATED_RESTORE_VECTOR_DEPENDENCY");
  assert.equal(classifyRestoreFailure("function public.audit_trigger() does not exist"), "ISOLATED_RESTORE_PUBLIC_OBJECT_DEPENDENCY");
  assert.equal(classifyRestoreFailure("unsupported version (1.16) in file header"), "ISOLATED_RESTORE_ARCHIVE_INCOMPATIBLE");
  assert.equal(classifyRestoreFailure('relation "Example" already exists'), "ISOLATED_RESTORE_TARGET_CONFLICT");
  assert.equal(classifyRestoreFailure("unrecognized restore failure"), "ISOLATED_RESTORE_COMMAND_FAILED");
  for (const sample of ["credential=value", "postgresql://example", "user@example.test"]) {
    assert.match(classifyRestoreFailure(sample), /^[A-Z0-9_]+$/u);
  }
});

test("isolated restore connects as the container postgres role", () => {
  const containerId = "a".repeat(64);
  assert.deepEqual(isolatedRestoreArgs(containerId), [
    "exec",
    containerId,
    "pg_restore",
    "--username=postgres",
    "--no-owner",
    "--no-privileges",
    "--exit-on-error",
    "--single-transaction",
    "--use-list=/tmp/staging-public.list",
    "--dbname=celebratedeal_restore",
    "/tmp/staging-public.dump",
  ]);
  assert.throws(() => isolatedRestoreArgs("not-a-container"), /ISOLATED_CONTAINER_ID_INVALID/u);
});

test("isolated readiness verifies the exact restore database", () => {
  const containerId = "b".repeat(64);
  const args = isolatedReadinessArgs(containerId);
  assert.deepEqual(args.slice(0, 5), ["exec", containerId, "psql", "-U", "postgres"]);
  assert.deepEqual(args.slice(-4), ["-v", "ON_ERROR_STOP=1", "-c", "SELECT 1;"]);
  assert.equal(args.includes("celebratedeal_restore"), true);
  assert.equal(args.includes("pg_isready"), false);
});

test("isolated restore mirrors allowlisted source extension placement", () => {
  assert.deepEqual(parseExtensionPlacements("pg_trgm|public\npgcrypto|extensions\n"), {
    pg_trgm: "public",
    pgcrypto: "extensions",
  });
  assert.throws(() => parseExtensionPlacements("pg_trgm|private\npgcrypto|extensions\n"), /SOURCE_EXTENSION_SCHEMA_UNSUPPORTED/u);
  assert.throws(() => parseExtensionPlacements("pg_trgm|public\n"), /SOURCE_EXTENSION_INVENTORY_INVALID/u);
  assert.throws(() => parseExtensionPlacements("pg_trgm|public|extra\npgcrypto|extensions\n"), /SOURCE_EXTENSION_INVENTORY_INVALID/u);
});

test("restore TOC removes only the pre-created public schema entry", () => {
  const toc = "; archive\n1; 2615 2200 SCHEMA - public postgres\n2; 1259 1 TABLE public Example postgres\n";
  const filtered = filteredRestoreList(toc);
  assert.doesNotMatch(filtered, /SCHEMA\s+-\s+public/u);
  assert.match(filtered, /TABLE public Example/u);
  assert.throws(() => filteredRestoreList("; archive\n2; TABLE public Example\n"), /ISOLATED_PUBLIC_SCHEMA_TOC_INVALID/u);
});

test("sanitized current-source PASS receipt satisfies the full gate", () => {
  const receipt = completePassReceipt();
  assert.deepEqual(validateReceipt(receipt, { pinnedMigrationTreeSha: BACKUP_MIGRATION_TREE_SHA }), { ok: true, errors: [] });
  assert.doesNotMatch(JSON.stringify(receipt), /postgres|https?:|password|token|cookie/iu);
  assert.equal(receipt.migration.status, "BACKUP_READY_MIGRATIONS_PENDING");
  assert.equal(receipt.retention.recoverability, "NOT_PROVEN");
  receipt.retention.migrationAuthorization = "READY";
  assert.equal(validateReceipt(receipt, { pinnedMigrationTreeSha: BACKUP_MIGRATION_TREE_SHA }).errors.includes("RECOVERY_NOT_PROVEN"), true);
  receipt.retention.migrationAuthorization = "BLOCKED";
  receipt.migration.status = "UP_TO_DATE";
  assert.equal(validateReceipt(receipt, { pinnedMigrationTreeSha: BACKUP_MIGRATION_TREE_SHA }).errors.includes("PASS_GATE_INCOMPLETE"), true);
});

test("receipt validation rejects extra fields, writes and secret-bearing text", () => {
  const receipt = completePassReceipt();
  receipt.database.rawRow = "unexpected";
  receipt.sideEffects.databaseWrites = 1;
  receipt.failureCategory = "https://unexpected.example";
  const errors = validateReceipt(receipt, { pinnedMigrationTreeSha: BACKUP_MIGRATION_TREE_SHA }).errors;
  assert.equal(errors.includes("SCHEMA_DATABASE"), true);
  assert.equal(errors.includes("FORBIDDEN_SIDE_EFFECTS"), true);
  assert.equal(errors.includes("FORBIDDEN_TEXT"), true);
});

// ---- Alias self-attestation (Vercel firewalls the immutable Preview host) ----

const previewHost = "safe-preview.vercel.app";
const aliasHealthUrl = `https://${STAGING_ALIAS_HOST}/api/health`;

function aliasHealth({ commitSha = sha, vercelUrl = previewHost, deploymentId = "dpl_Fixture123", status = 200, headers = {}, body } = {}) {
  const payload = body ?? { ok: true, database: "ok", latencyMs: 3, deployment: { commitSha, deploymentId, vercelUrl } };
  return new Response(typeof payload === "string" ? payload : JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

test("alias attestation passes only for the exact SHA and Preview host served through the fixed alias", async () => {
  const requests = [];
  const result = await verifyAliasAttestation({ sourceSha: sha, previewHost }, async (url, init) => {
    requests.push({ url: String(url), init });
    return aliasHealth();
  });
  assert.deepEqual(result, { host: STAGING_ALIAS_HOST, healthStatus: 200, noRedirect: true, commitShaMatched: true, vercelUrlMatched: true });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, aliasHealthUrl);
  assert.equal(requests[0].init.method, "GET");
  assert.equal(requests[0].init.redirect, "manual");
  assert.equal(requests[0].init.headers.Authorization, undefined);
  // The Preview host itself is never contacted.
  assert.equal(requests.some((request) => request.url.includes(previewHost)), false);
  // Vercel reports VERCEL_URL in lowercase; a null deployment id is shape-valid.
  await verifyAliasAttestation({ sourceSha: sha, previewHost }, async () => aliasHealth({ vercelUrl: previewHost.toUpperCase(), deploymentId: null }));
});

test("alias attestation fails closed on SHA drift, host drift, missing fields and unreachable alias", async () => {
  const attest = (fetchImpl) => verifyAliasAttestation({ sourceSha: sha, previewHost }, fetchImpl);
  await assert.rejects(attest(async () => aliasHealth({ commitSha: "b".repeat(40) })), /^Error: ALIAS_ATTESTATION_SHA_MISMATCH$/u);
  await assert.rejects(attest(async () => aliasHealth({ vercelUrl: "other-preview.vercel.app" })), /^Error: ALIAS_ATTESTATION_HOST_MISMATCH$/u);
  await assert.rejects(attest(async () => { throw new TypeError("fetch failed"); }), /^Error: ALIAS_ATTESTATION_UNREACHABLE$/u);
  await assert.rejects(attest(async () => aliasHealth({ status: 403, headers: { "x-vercel-mitigated": "deny" } })), /^Error: ALIAS_ATTESTATION_HTTP_REJECTED$/u);
  await assert.rejects(attest(async () => aliasHealth({ status: 503, body: { ok: false, database: "failed", deployment: { commitSha: sha, deploymentId: null, vercelUrl: previewHost } } })), /^Error: ALIAS_ATTESTATION_HTTP_REJECTED$/u);
  await assert.rejects(attest(async () => aliasHealth({ status: 307, headers: { location: "https://elsewhere.example/" } })), /^Error: ALIAS_ATTESTATION_REDIRECTED$/u);
  await assert.rejects(attest(async () => aliasHealth({ headers: { location: "https://elsewhere.example/" } })), /^Error: ALIAS_ATTESTATION_REDIRECTED$/u);

  // Responses missing the identity, or any of its fields, are never treated as proof.
  const missing = [
    { ok: true, database: "ok", latencyMs: 1 },
    { ok: true, database: "ok", deployment: { commitSha: sha, vercelUrl: previewHost } },
    { ok: true, database: "ok", deployment: { deploymentId: null, vercelUrl: previewHost } },
    { ok: true, database: "ok", deployment: { commitSha: sha, deploymentId: null } },
    { ok: true, database: "ok", deployment: { commitSha: null, deploymentId: null, vercelUrl: previewHost } },
    { ok: true, database: "ok", deployment: { commitSha: sha, deploymentId: null, vercelUrl: null } },
    { ok: true, database: "ok", deployment: { commitSha: sha, deploymentId: "not-a-dpl", vercelUrl: previewHost } },
    { ok: true, database: "ok", deployment: { commitSha: sha, deploymentId: null, vercelUrl: previewHost, extra: "x" } },
    { ok: false, database: "ok", deployment: { commitSha: sha, deploymentId: null, vercelUrl: previewHost } },
    { ok: true, database: "failed", deployment: { commitSha: sha, deploymentId: null, vercelUrl: previewHost } },
  ];
  for (const body of missing) {
    await assert.rejects(attest(async () => aliasHealth({ body })), /^Error: ALIAS_ATTESTATION_FIELDS_MISSING$/u, JSON.stringify(body));
  }
  await assert.rejects(attest(async () => new Response("<html>ok</html>", { status: 200, headers: { "content-type": "text/html" } })), /^Error: ALIAS_ATTESTATION_RESPONSE_INVALID$/u);
  await assert.rejects(attest(async () => aliasHealth({ body: "not json" })), /^Error: ALIAS_ATTESTATION_RESPONSE_INVALID$/u);
  await assert.rejects(attest(async () => aliasHealth({ body: "[]" })), /^Error: ALIAS_ATTESTATION_RESPONSE_INVALID$/u);
  await assert.rejects(attest(async () => aliasHealth({ body: JSON.stringify({ padding: "x".repeat(5000) }) })), /^Error: ALIAS_ATTESTATION_RESPONSE_INVALID$/u);
});

test("alias attestation rejects malformed expectations before any request", async () => {
  let requested = false;
  const spy = async () => { requested = true; return aliasHealth(); };
  for (const input of [
    { sourceSha: "main", previewHost },
    { sourceSha: sha, previewHost: STAGING_ALIAS_HOST },
    { sourceSha: sha, previewHost: "https://safe-preview.vercel.app" },
    { sourceSha: sha, previewHost: "" },
    {},
  ]) {
    await assert.rejects(verifyAliasAttestation(input, spy), /^Error: ALIAS_ATTESTATION_INPUT_INVALID$/u);
  }
  assert.equal(requested, false);
  for (const code of ALIAS_ATTESTATION_FAILURES) assert.match(code, /^ALIAS_ATTESTATION_[A-Z_]+$/u);
});

function lineageThenAlias(aliasResponse, requests = []) {
  const responses = [
    new Response(JSON.stringify([vercelDeployment(42)]), { status: 200 }),
    new Response(JSON.stringify(exactHostSuccess), { status: 200 }),
  ];
  return async (url) => {
    requests.push(String(url));
    if (String(url) === aliasHealthUrl) return aliasResponse();
    return responses.shift();
  };
}

test("lineage gate and alias attestation compose into the alias-only operation host", async () => {
  const requests = [];
  const result = await verifyDeploymentThroughAlias(environment(), lineageThenAlias(() => aliasHealth(), requests));
  assert.equal(result.host, previewHost);
  assert.equal(result.operationHost, STAGING_ALIAS_HOST);
  assert.equal(result.alias.commitShaMatched, true);
  assert.equal(requests.at(-1), aliasHealthUrl);
  assert.equal(requests.some((url) => url.startsWith(`https://${previewHost}`)), false);
  await assert.rejects(
    verifyDeploymentThroughAlias(environment(), lineageThenAlias(() => aliasHealth({ commitSha: "c".repeat(40) }))),
    /^Error: ALIAS_ATTESTATION_SHA_MISMATCH$/u,
  );
});

test("WP2 records the alias health and stops before any database work when the alias serves another deployment", async () => {
  const drifted = await runSecureTask("wp2-readonly-restore", environment(), {
    fetchImpl: lineageThenAlias(() => aliasHealth({ vercelUrl: "older-preview.vercel.app" })),
    spawnSyncImpl: () => { throw new Error("must not inventory"); },
  });
  assert.equal(drifted.result, "BLOCKED");
  assert.equal(drifted.failureCategory, "ALIAS_ATTESTATION_HOST_MISMATCH");
  assert.equal(drifted.lineage.deploymentMatched, true);
  assert.equal(drifted.lineage.healthStatus, null);
  assert.equal(drifted.database.connectionAttempts, 0);

  // A passing attestation proceeds to the next fixed gate (here: source inventory fails closed).
  const attested = await runSecureTask("wp2-readonly-restore", environment(), {
    fetchImpl: lineageThenAlias(() => aliasHealth()),
    spawnSyncImpl: () => ({ status: 1, stdout: "" }),
  });
  assert.equal(attested.result, "BLOCKED");
  assert.equal(attested.failureCategory, "SOURCE_COMMIT_UNAVAILABLE");
  assert.equal(attested.lineage.healthStatus, 200);
  assert.equal(attested.lineage.noRedirect, true);
  assert.equal(attested.database.connectionAttempts, 0);
});
