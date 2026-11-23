import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import test from "node:test";

import net from "node:net";

import { TASK, databaseShape, prismaDatabaseUrl, probeDatabaseTcp, runLineStagingValidation, safeFailure, validateInvocation, validateReceipt } from "./secure-staging-line-notifications.mjs";

const source = {
  STAGING_DATABASE_URL: "postgresql://staging_user@staging.invalid/postgres",
  CSRF_SECRET: "x".repeat(32), CRON_SECRET: "y".repeat(32),
  LINE_STAGING_MESSAGING_CHANNEL_ID: "123", LINE_STAGING_MESSAGING_CHANNEL_SECRET: "s".repeat(32),
  LINE_STAGING_MESSAGING_ACCESS_TOKEN: "t".repeat(64), LINE_STAGING_USER_ID: "U".repeat(33),
  CELEBRATEDEAL_SOURCE_SHA: "a".repeat(40), CELEBRATEDEAL_DEPLOYMENT_HOST: "preview.vercel.app",
  RUNNER_TEMP: "/tmp/runner", GITHUB_RUN_ID: "1", GITHUB_RUN_ATTEMPT: "1",
  SECURE_RECEIPT_PATH: "/tmp/runner/celebratedeal-secure-receipts/line-notifications-e2e-receipt.json",
  LINE_STAGING_DATABASE_IDENTITY_SHA256: crypto.createHash("sha256").update(["staging.invalid", "5432", "/postgres", "staging_user", "public"].join("\n")).digest("hex"),
};

function passingReceipt() {
  return {
    schemaVersion: "celebratedeal-line-notifications-e2e/v1", task: TASK, result: "PASS",
    sourceCommit: "a".repeat(40), runRefHash: `sha256:${"b".repeat(64)}`,
    checks: { isolatedDatabase: true, runtimeDatabaseBound: true, invalidBearerRejected: true, invalidBearerNoWrite: true, validBearerAccepted: true, materializedCount: 1, sentCount: 1, deliveryStatus: "sent", attemptCount: 1, sentAtPresent: true, idempotencyProbePassed: true, tenantIsolationPassed: true },
    sideEffects: { cronCalls: 3, logicalLinePushes: 1, budgetExceeded: false },
    cleanup: { attempted: true, verified: true, remainingOwnedRows: 0 },
    safety: { sanitized: true, productionOperations: 0, deployments: 0, aliasMutations: 0 },
    failureCode: null,
  };
}

test("accepts only fixed bindings and an exact Preview host", () => {
  assert.deepEqual(validateInvocation(source), { ok: true, reason: null });
  assert.equal(validateInvocation({ ...source, CELEBRATEDEAL_DEPLOYMENT_HOST: "attacker.example" }).ok, false);
  assert.equal(validateInvocation({ ...source, CRON_SECRET: "" }).ok, false);
  assert.deepEqual(validateInvocation({ ...source, DATA_ENCRYPTION_KEYRING: "" }), { ok: true, reason: null });
  assert.deepEqual(validateInvocation({ ...source, DATA_ENCRYPTION_KEYRING: JSON.stringify([{ kid: "d2611a", key: Buffer.alloc(32, 5).toString("base64url"), active: true }, { kid: "legacy" }]) }), { ok: true, reason: null });
  assert.deepEqual(validateInvocation({ ...source, DATA_ENCRYPTION_KEYRING: "[]" }), { ok: false, reason: "DATA_ENCRYPTION_KEYRING_INVALID" });
  assert.equal(validateInvocation({ ...source, LINE_STAGING_DATABASE_IDENTITY_SHA256: "0".repeat(64) }).ok, false);
  assert.equal(validateInvocation({ ...source, STAGING_DATABASE_URL: `${source.STAGING_DATABASE_URL}?schema=production` }).ok, false);
});

test("canonical receipt enforces cleanup and side-effect budgets", () => {
  assert.deepEqual(validateReceipt(passingReceipt()), { ok: true, errors: [] });
  assert.equal(validateReceipt({ ...passingReceipt(), cleanup: { attempted: true, verified: false, remainingOwnedRows: 1 } }).ok, false);
  assert.equal(validateReceipt({ ...passingReceipt(), sideEffects: { cronCalls: 4, logicalLinePushes: 2, budgetExceeded: true } }).ok, false);
  assert.equal(validateReceipt({ ...passingReceipt(), checks: { ...passingReceipt().checks, invalidBearerNoWrite: false } }).ok, false);
  assert.equal(validateReceipt(passingReceipt(), { sourceCommit: "c".repeat(40), runId: "1", runAttempt: "1" }).ok, false);
});

test("receipt rejects secrets, database URLs, bearer values and extra fields", () => {
  const databaseCanary = `${"post"}gresql://${"user"}:${"pass"}@db.invalid/postgres`;
  for (const failureCode of ["Bearer abc", databaseCanary, "LINE_STAGING_USER_ID"]) {
    assert.equal(validateReceipt({ ...passingReceipt(), result: "FAILED", failureCode }).ok, false);
  }
  assert.equal(validateReceipt({ ...passingReceipt(), rawResponse: {} }).ok, false);
});

test("stops before any database or cron request unless the alias attests the exact Preview", async () => {
  for (const failure of [
    async () => { throw new Error("ALIAS_ATTESTATION_SHA_MISMATCH"); },
    async () => { throw new Error("ALIAS_ATTESTATION_UNREACHABLE"); },
    async () => ({ host: "preview.vercel.app" }),
  ]) {
    const receipt = await runLineStagingValidation(source, { verifyShaOnProtectedMasterImpl: async () => true, verifyAliasAttestationImpl: failure });
    assert.equal(receipt.result, "BLOCKED");
    assert.match(receipt.failureCode, /^ALIAS_ATTESTATION_[A-Z_]+$/u);
    assert.equal(receipt.sideEffects.cronCalls, 0);
    assert.equal(receipt.cleanup.attempted, false);
    assert.equal(receipt.checks.isolatedDatabase, false);
  }
  let received = null;
  await runLineStagingValidation(source, {
    verifyShaOnProtectedMasterImpl: async () => true,
    verifyAliasAttestationImpl: async (input) => { received = input; throw new Error("ALIAS_ATTESTATION_HOST_MISMATCH"); },
  });
  assert.deepEqual(received, { sourceSha: source.CELEBRATEDEAL_SOURCE_SHA, previewHost: source.CELEBRATEDEAL_DEPLOYMENT_HOST });
});

test("cron requests address the attested alias, never the firewalled Preview host", () => {
  const runner = fs.readFileSync(new URL("./secure-staging-line-notifications.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(runner, /https:\/\/\$\{source\.CELEBRATEDEAL_DEPLOYMENT_HOST\}/u);
  assert.match(runner, /fetch\(`https:\/\/\$\{operationHost\}\/api\/cron\/line-notifications`/u);
});

test("a non-master SHA is BLOCKED before alias attestation, even if the alias would attest", async () => {
  let attested = false;
  let checked = null;
  const receipt = await runLineStagingValidation({ ...source, GITHUB_TOKEN: "read-only-workflow-token" }, {
    verifyShaOnProtectedMasterImpl: async (sha, token) => { checked = { sha, token }; throw new Error("SOURCE_NOT_ON_PROTECTED_MASTER"); },
    verifyAliasAttestationImpl: async () => { attested = true; return { host: "celebrate-deal-staging.carry-digital-nomad.in.net" }; },
  });
  assert.deepEqual(checked, { sha: source.CELEBRATEDEAL_SOURCE_SHA, token: "read-only-workflow-token" });
  assert.equal(attested, false);
  assert.equal(receipt.result, "BLOCKED");
  assert.equal(receipt.failureCode, "SOURCE_NOT_ON_PROTECTED_MASTER");
  assert.equal(receipt.sideEffects.cronCalls, 0);
  assert.equal(receipt.cleanup.attempted, false);
  // Without the read-only token the shared gate fails closed.
  const tokenless = await runLineStagingValidation(source, { verifyAliasAttestationImpl: async () => { attested = true; return {}; } });
  assert.equal(tokenless.failureCode, "PROTECTED_MASTER_CHECK_FAILED");
  assert.equal(attested, false);
});

const attestedDeps = {
  verifyShaOnProtectedMasterImpl: async () => true,
  verifyAliasAttestationImpl: async () => ({ host: "celebrate-deal-staging.carry-digital-nomad.in.net" }),
  probeDatabaseTcpImpl: async () => null,
};

function prismaLikeError(name, props, message) {
  const error = new Error(message);
  error.name = name;
  return Object.assign(error, props);
}

function brokenDb(rootError) {
  const fail = async () => { throw rootError; };
  return {
    lineOfficialAccount: { count: fail }, lineUserIdentity: { count: fail }, lineDelivery: { count: fail },
    $transaction: fail, $disconnect: async () => undefined,
  };
}

test("keeps the root failure code when cleanup also fails", async () => {
  const root = prismaLikeError("PrismaClientInitializationError", { errorCode: "P1001" }, "Can't reach database server at `db.secret-host.example:5432`");
  const receipt = await runLineStagingValidation(source, { ...attestedDeps, createDb: () => brokenDb(root) });
  assert.equal(receipt.result, "FAILED");
  assert.equal(receipt.failureCode, "PRISMA_P1001");
  assert.equal(receipt.cleanup.attempted, true);
  assert.equal(receipt.cleanup.verified, false);
  assert.equal(receipt.checks.isolatedDatabase, false);
  assert.equal(validateReceipt(receipt).ok, true);
  assert.doesNotMatch(JSON.stringify(receipt), /secret-host|5432/u);
});

test("root failure survives a failing cleanup for our own coded errors too", async () => {
  const dirty = async () => 1;
  const db = {
    lineOfficialAccount: { count: dirty }, lineUserIdentity: { count: dirty }, lineDelivery: { count: dirty },
    $transaction: async () => { throw new Error("tx failed"); }, $disconnect: async () => undefined,
  };
  const receipt = await runLineStagingValidation(source, { ...attestedDeps, createDb: () => db });
  assert.equal(receipt.failureCode, "DATABASE_NOT_ISOLATED");
  assert.equal(receipt.cleanup.verified, false);
});

test("safeFailure maps Prisma errors to fixed codes and never leaks message text", () => {
  const secret = ["postgresql", "//user:pw@db.secret-host.example:5432/postgres"].join(":");
  assert.equal(safeFailure(prismaLikeError("PrismaClientInitializationError", { errorCode: "P1001" }, secret)), "PRISMA_P1001");
  assert.equal(safeFailure(prismaLikeError("PrismaClientKnownRequestError", { code: "P2021" }, secret)), "PRISMA_P2021");
  assert.equal(safeFailure(prismaLikeError("PrismaClientInitializationError", {}, secret)), "PRISMA_INIT_FAILED");
  assert.equal(safeFailure(prismaLikeError("PrismaClientUnknownRequestError", {}, secret)), "PRISMA_UNKNOWN_REQUEST");
  assert.equal(safeFailure(prismaLikeError("PrismaClientRustPanicError", {}, secret)), "PRISMA_RUST_PANIC");
  assert.equal(safeFailure(prismaLikeError("PrismaClientInitializationError", { errorCode: "bad code" }, secret)), "PRISMA_INIT_FAILED");
  assert.equal(safeFailure(new Error(secret)), "UNCLASSIFIED_FAILURE");
  assert.equal(safeFailure(new Error("DATABASE_NOT_ISOLATED")), "DATABASE_NOT_ISOLATED");
  for (const error of [prismaLikeError("PrismaClientInitializationError", { errorCode: "P1001" }, secret), new Error(secret)]) {
    assert.doesNotMatch(safeFailure(error), /secret-host|postgresql|pw/u);
  }
});

test("Prisma init errors without errorCode map to closed connection categories", () => {
  const host = "aws-0-secret.pooler.supabase.com:6543";
  const cases = [
    [`Can't reach database server at \`${host}\``, "PRISMA_INIT_UNREACHABLE"],
    ["Error querying the database: FATAL: Tenant or user not found", "PRISMA_INIT_TENANT_OR_USER_NOT_FOUND"],
    [`Authentication failed against database server at \`${host}\``, "PRISMA_INIT_AUTH_FAILED"],
    ["FATAL: Max client connections reached", "PRISMA_INIT_CONNECTION_LIMIT"],
    ["Database `postgres` does not exist on the database server", "PRISMA_INIT_DATABASE_MISSING"],
    ["Error opening a TLS connection: certificate verify failed", "PRISMA_INIT_TLS"],
    [`Timed out fetching a new connection from the connection pool at \`${host}\``, "PRISMA_INIT_TIMEOUT"],
    ["Server has closed the connection.", "PRISMA_INIT_CONNECTION_CLOSED"],
    ["error: Environment variable not found: DIRECT_URL.", "PRISMA_INIT_ENV_MISSING"],
    ["Unable to require(`libquery_engine-debian-openssl-3.0.x.so.node`).", "PRISMA_INIT_ENGINE_UNAVAILABLE"],
    ["something new", "PRISMA_INIT_FAILED"],
  ];
  for (const [message, code] of cases) {
    const failure = safeFailure(prismaLikeError("PrismaClientInitializationError", {}, message));
    assert.equal(failure, code);
    assert.doesNotMatch(failure, /secret|pooler|6543/u);
  }
  // A real P-code still wins over the message.
  assert.equal(safeFailure(prismaLikeError("PrismaClientInitializationError", { errorCode: "P1000" }, cases[0][0])), "PRISMA_P1000");
});

test("a failed TCP probe stops before Prisma and records only a fixed code", async () => {
  let created = false;
  const receipt = await runLineStagingValidation(source, {
    ...attestedDeps,
    probeDatabaseTcpImpl: async () => "DB_TCP_TIMEOUT",
    createDb: () => { created = true; throw new Error("must not create"); },
  });
  assert.equal(created, false);
  assert.equal(receipt.result, "FAILED");
  assert.equal(receipt.failureCode, "DB_TCP_TIMEOUT");
  assert.equal(receipt.cleanup.attempted, false);
  assert.equal(receipt.sideEffects.cronCalls, 0);
});

test("the TCP probe distinguishes refused, unresolved and reachable endpoints", async () => {
  const server = net.createServer((socket) => socket.destroy());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    assert.equal(await probeDatabaseTcp(`postgresql://u:p@127.0.0.1:${port}/postgres`), null);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  assert.equal(await probeDatabaseTcp(`postgresql://u:p@127.0.0.1:${port}/postgres`), "DB_TCP_REFUSED");
  assert.equal(await probeDatabaseTcp("postgresql://u:p@unresolvable.invalid:5432/postgres"), "DB_TCP_UNRESOLVED");
  assert.equal(await probeDatabaseTcp("not a url"), "DB_TCP_BINDING_INVALID");
});

test("databaseShape reports only provider, port and user-form classes", () => {
  assert.equal(databaseShape("postgresql://postgres.abcref:pw@aws-0-ap-south-1.pooler.supabase.com:6543/postgres"), "supabase_pooler:6543:ref_user");
  assert.equal(databaseShape("postgresql://postgres:pw@aws-0-ap-south-1.pooler.supabase.com/postgres"), "supabase_pooler:5432:plain_user");
  assert.equal(databaseShape("postgresql://postgres:pw@db.abcref.supabase.co:5432/postgres"), "supabase_direct:5432:plain_user");
  assert.equal(databaseShape("postgresql://u:pw@10.0.0.1:7777/postgres"), "other:other:plain_user");
  assert.equal(databaseShape("nope"), "invalid");
  assert.doesNotMatch(databaseShape("postgresql://postgres.abcref:pw@aws-0-ap-south-1.pooler.supabase.com:6543/postgres"), /abcref|pw|ap-south/u);
});

test("only the Supabase transaction pooler gets Prisma pgbouncer mode", () => {
  assert.equal(new URL(prismaDatabaseUrl("postgresql://postgres.ref:pw@aws-0-x.pooler.supabase.com:6543/postgres?schema=public")).searchParams.get("pgbouncer"), "true");
  assert.equal(new URL(prismaDatabaseUrl("postgresql://postgres.ref:pw@aws-0-x.pooler.supabase.com:5432/postgres")).searchParams.get("pgbouncer"), null);
  assert.equal(new URL(prismaDatabaseUrl("postgresql://u:pw@staging.invalid:6543/postgres")).searchParams.get("pgbouncer"), null);
});
