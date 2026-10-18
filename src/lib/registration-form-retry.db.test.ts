import { createHash, randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteRegistrationRetryDraft,
  readRegistrationRetryDraft,
  REGISTRATION_RETRY_LOCK_NAMESPACE,
  REGISTRATION_RETRY_MAX_ROWS_PER_VENDOR,
  REGISTRATION_RETRY_TTL_MS,
  saveRegistrationRetryDraft,
  sweepExpiredRegistrationRetryDrafts,
} from "./registration-form-retry";
import { assertLocalTestDatabase } from "../../scripts/local-database-safety";

// Shared loopback isolation check; also refuses the interactive dev database.
assertLocalTestDatabase("DATABASE_URL", process.env.DATABASE_URL);
const databaseName = decodeURIComponent(new URL(process.env.DATABASE_URL).pathname.slice(1));
if (!/^celebratedeal_(?:test|ci|e2e|wp17_ci|wp18_ci)$/iu.test(databaseName)) {
  throw new Error("Disposable test database required");
}
const db = new PrismaClient();
const CAP = REGISTRATION_RETRY_MAX_ROWS_PER_VENDOR;
const createdVendorIds: string[] = [];
const fixtureHash = () => createHash("sha256").update(randomUUID()).digest("hex");

async function tenantForm(label: string) {
  const suffix = `wp05-${label}-${randomUUID()}`;
  const vendor = await db.vendor.create({ data: { name: "Synthetic Retry", slug: suffix, email: `${suffix}@example.test`, passwordHash: "synthetic-unused" } });
  createdVendorIds.push(vendor.id);
  const form = await db.registrationForm.create({ data: { vendorId: vendor.id, name: "Synthetic Retry", slug: suffix, headline: "Synthetic Retry", fields: [{ key: "name", label: "Name", type: "text", required: true }] } });
  return { vendorId: vendor.id, formId: form.id };
}
function fillRows(scope: { vendorId: string; formId: string }, count: number, expiresAt: Date) {
  return db.registrationFormRetryDraft.createMany({ data: Array.from({ length: count }, () => ({
    idHash: fixtureHash(), vendorId: scope.vendorId, formId: scope.formId, sourcePath: "/form/synthetic", encryptedPayload: "v1.synthetic-fixture", createdAt: new Date(+expiresAt - REGISTRATION_RETRY_TTL_MS), expiresAt,
  })) });
}
const draftInput = (scope: { vendorId: string; formId: string }, status: 400 | 503 = 400) => ({
  ...scope, sourcePath: "/form/synthetic", answers: { name: "Synthetic" }, liveId: null, status,
});

beforeAll(async () => {
  // Leftover expired fixtures from an aborted run must not count as capacity.
  await db.registrationFormRetryDraft.deleteMany({ where: { expiresAt: { lte: new Date() } } });
});
beforeEach(() => { vi.stubEnv("CSRF_SECRET", "wp05-synthetic-encryption-".repeat(3)); vi.stubEnv("JOB_SECRET", ""); });
afterEach(async () => {
  try { await db.vendor.deleteMany({ where: { id: { in: createdVendorIds.splice(0) } } }); }
  finally { vi.unstubAllEnvs(); }
});
afterAll(() => db.$disconnect());

describe("retry draft disposable PostgreSQL", () => {
  it("persists maximum fields encrypted and reads after reconnect before expiry", async () => {
    const scope = await tenantForm("roundtrip");
    const sourcePath = "/form/synthetic";
    const now = new Date();
    const answers = Object.fromEntries(Array.from({ length: 32 }, (_, i) => [`field${i}`, "字".repeat(2000)]));
    const capability = await saveRegistrationRetryDraft(db, { ...scope, sourcePath, answers, liveId: null, status: 503 }, now);
    expect(capability).not.toBeNull();
    const row = await db.registrationFormRetryDraft.findFirstOrThrow({ where: { formId: scope.formId } });
    expect(row.idHash).not.toBe(capability);
    expect(row.vendorId).toBe(scope.vendorId);
    expect(row.encryptedPayload).not.toContain("字");
    expect(row.expiresAt.getTime()).toBe(+now + REGISTRATION_RETRY_TTL_MS);
    await db.$disconnect();
    // A binding mismatch neither reveals nor consumes the draft.
    expect(await readRegistrationRetryDraft(db, { capability: capability!, formId: "other-tenant-form", sourcePath }, now)).toBeNull();
    const restored = await readRegistrationRetryDraft(db, { capability: capability!, formId: scope.formId, sourcePath }, now);
    expect(restored?.answers).toEqual(answers);
    // Single use: the prefill read deleted the ciphertext.
    expect(await db.registrationFormRetryDraft.count({ where: { formId: scope.formId } })).toBe(0);
    expect(await readRegistrationRetryDraft(db, { capability: capability!, formId: scope.formId, sourcePath }, now)).toBeNull();
    const expiring = await saveRegistrationRetryDraft(db, { ...scope, sourcePath, answers, liveId: null, status: 503 }, now);
    expect(await readRegistrationRetryDraft(db, { capability: expiring!, formId: scope.formId, sourcePath }, new Date(+now + REGISTRATION_RETRY_TTL_MS))).toBeNull();
    expect(await db.registrationFormRetryDraft.count({ where: { formId: scope.formId } })).toBe(0);
    const retry = await saveRegistrationRetryDraft(db, { ...scope, sourcePath, answers, liveId: null, status: 400 }, now);
    expect(retry).not.toBeNull();
    expect(await deleteRegistrationRetryDraft(db, retry!)).toBe(true);
    expect(await readRegistrationRetryDraft(db, { capability: retry!, formId: scope.formId, sourcePath }, now)).toBeNull();
    expect(await db.registrationFormRetryDraft.count({ where: { formId: scope.formId } })).toBe(0);
  });

  it("rejects a form of another tenant at the database boundary", async () => {
    const owner = await tenantForm("owner");
    const other = await tenantForm("other");
    // Even a caller bug that pairs one tenant with another tenant's form fails closed.
    expect(await saveRegistrationRetryDraft(db, draftInput({ vendorId: other.vendorId, formId: owner.formId }))).toBeNull();
    expect(await db.registrationFormRetryDraft.count({ where: { formId: owner.formId } })).toBe(0);
    await expect(db.registrationFormRetryDraft.create({ data: {
      idHash: fixtureHash(), vendorId: other.vendorId, formId: owner.formId, sourcePath: "/form/synthetic", encryptedPayload: "v1.synthetic", expiresAt: new Date(Date.now() + 60_000),
    } })).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
  });

  it("enforces the hash, path, envelope and expiry CHECK constraints", async () => {
    const scope = await tenantForm("checks");
    const valid = { idHash: fixtureHash(), ...scope, sourcePath: "/form/synthetic", encryptedPayload: "v1.synthetic", expiresAt: new Date(Date.now() + 60_000) };
    for (const invalid of [
      { ...valid, idHash: "plain-capability" },
      { ...valid, idHash: fixtureHash(), sourcePath: "/form/synthetic?email=x" },
      { ...valid, idHash: fixtureHash(), sourcePath: "https://attacker.test/form/x" },
      { ...valid, idHash: fixtureHash(), encryptedPayload: "{\"name\":\"plaintext\"}" },
      { ...valid, idHash: fixtureHash(), createdAt: new Date(), expiresAt: new Date(Date.now() - 60_000) },
      // Upper bound: never longer-lived than the 10-minute TTL.
      { ...valid, idHash: fixtureHash(), createdAt: new Date(), expiresAt: new Date(Date.now() + REGISTRATION_RETRY_TTL_MS + 60_000) },
      { ...valid, idHash: fixtureHash(), sourcePath: "/form/%E5%A4%8F" },
      { ...valid, idHash: fixtureHash(), sourcePath: "/form/../admin" },
      { ...valid, idHash: fixtureHash(), sourcePath: "/form/a b" },
      { ...valid, idHash: fixtureHash(), sourcePath: "/form/a\\b" },
      { ...valid, idHash: fixtureHash(), sourcePath: "/form/a/b/c" },
    ]) {
      await expect(db.registrationFormRetryDraft.create({ data: invalid })).rejects.toThrow();
    }
    expect(await db.registrationFormRetryDraft.count({ where: { formId: scope.formId } })).toBe(0);
  });

  it("accepts canonical CJK slug paths in the database and round trips them", async () => {
    const scope = await tenantForm("cjk");
    const now = new Date();
    for (const sourcePath of ["/form/夏季-新品-live", "/p/團隊-頁面", "/lp/campaign/thank-you"]) {
      await db.registrationFormRetryDraft.create({ data: { idHash: fixtureHash(), ...scope, sourcePath, encryptedPayload: "v1.synthetic", createdAt: now, expiresAt: new Date(+now + 60_000) } });
    }
    const capability = await saveRegistrationRetryDraft(db, { ...draftInput(scope), sourcePath: "/form/%E5%A4%8F%E5%AD%A3-%E6%96%B0%E5%93%81-live" }, now);
    expect(capability).not.toBeNull();
    expect(await db.registrationFormRetryDraft.count({ where: { formId: scope.formId, sourcePath: "/form/夏季-新品-live" } })).toBe(2);
    expect(await readRegistrationRetryDraft(db, { capability: capability!, formId: scope.formId, sourcePath: "/form/夏季-新品-live" }, now)).toMatchObject({ sourcePath: "/form/夏季-新品-live" });
  });

  it("deletes drafts with the form", async () => {
    const scope = await tenantForm("cascade");
    expect(await saveRegistrationRetryDraft(db, draftInput(scope))).not.toBeNull();
    await db.registrationForm.delete({ where: { id: scope.formId } });
    expect(await db.registrationFormRetryDraft.count({ where: { vendorId: scope.vendorId } })).toBe(0);
  });

  it("enables row level security on the draft table", async () => {
    const rows = await db.$queryRaw<Array<{ enabled: boolean }>>`SELECT relrowsecurity AS enabled FROM pg_class WHERE relname = 'RegistrationFormRetryDraft' AND relkind = 'r' AND relnamespace = current_schema()::regnamespace`;
    expect(rows).toEqual([{ enabled: true }]);
  });
});

it.each(["ReadCommitted", "RepeatableRead"] as const)("serializes concurrent writes of one tenant even with %s client default", async (isolationLevel) => {
  const client = new PrismaClient({ transactionOptions: { isolationLevel } });
  try {
    // Proves the test client really uses a different default; the product code must override it.
    const observed = await client.$transaction((tx) => tx.$queryRaw<Array<{ transaction_isolation: string }>>`SHOW transaction_isolation`);
    expect(observed[0].transaction_isolation).toBe(isolationLevel === "RepeatableRead" ? "repeatable read" : "read committed");
    const scope = await tenantForm(`cap-${isolationLevel}`);
    await fillRows(scope, CAP - 1, new Date(Date.now() + 600_000));
    const results = await Promise.all(Array.from({ length: 8 }, () => saveRegistrationRetryDraft(client, draftInput(scope))));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await db.registrationFormRetryDraft.count({ where: { vendorId: scope.vendorId } })).toBe(CAP);
  } finally { await client.$disconnect(); }
});

it("keeps capacity for another tenant while one tenant is full", async () => {
  const flooded = await tenantForm("flooded");
  const other = await tenantForm("unaffected");
  await fillRows(flooded, CAP, new Date(Date.now() + 600_000));
  expect(await saveRegistrationRetryDraft(db, draftInput(flooded))).toBeNull();
  const saved = await saveRegistrationRetryDraft(db, draftInput(other));
  expect(saved).not.toBeNull();
  expect(await readRegistrationRetryDraft(db, { capability: saved!, formId: other.formId, sourcePath: "/form/synthetic" })).toMatchObject({ answers: { name: "Synthetic" } });
});

it("reports a contended, not full tenant as unavailable without holding pool connections", async () => {
  const scope = await tenantForm("contended");
  const target = new URL(process.env.DATABASE_URL!); target.searchParams.set("connection_limit", "2");
  const limited = new PrismaClient({ datasourceUrl: target.toString() });
  let release!: () => void;
  let acquired!: () => void;
  const unlock = new Promise<void>((resolve) => { release = resolve; });
  const ready = new Promise<void>((resolve) => { acquired = resolve; });
  const holder = db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${REGISTRATION_RETRY_LOCK_NAMESPACE}::int4, hashtext(${scope.vendorId}))`;
    acquired(); await unlock;
  }, { timeout: 10_000 });
  const pending: Array<Promise<unknown>> = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([ready, holder]);
    const started = Date.now();
    for (let i = 0; i < 8; i++) pending.push(saveRegistrationRetryDraft(limited, draftInput(scope)));
    pending.push(limited.$queryRaw`SELECT 1`);
    const results = await Promise.race([
      Promise.all(pending),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Contended writers blocked the two-connection pool")), 2_000); }),
    ]);
    expect(results.slice(0, 8)).toEqual(Array(8).fill(null));
    expect(results[8]).toEqual([{ "?column?": 1 }]);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(await db.registrationFormRetryDraft.count({ where: { vendorId: scope.vendorId } })).toBe(0);
  } finally {
    clearTimeout(timer); release(); await holder;
    await Promise.allSettled(pending); await limited.$disconnect();
  }
  // Once the lock is free the tenant can store again.
  expect(await saveRegistrationRetryDraft(db, draftInput(scope))).not.toBeNull();
}, 15_000);

it("rejects a full tenant store without queueing behind its lock or starving the pool", async () => {
  const scope = await tenantForm("full");
  await fillRows(scope, CAP, new Date(Date.now() + 600_000));
  const target = new URL(process.env.DATABASE_URL!); target.searchParams.set("connection_limit", "2");
  const limited = new PrismaClient({ datasourceUrl: target.toString() });
  let release!: () => void;
  let acquired!: () => void;
  const unlock = new Promise<void>((resolve) => { release = resolve; });
  const ready = new Promise<void>((resolve) => { acquired = resolve; });
  // Another connection holds the same tenant lock; a full store must not wait for it.
  const holder = db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${REGISTRATION_RETRY_LOCK_NAMESPACE}::int4, hashtext(${scope.vendorId}))`;
    acquired(); await unlock;
  }, { timeout: 10_000 });
  const pending: Array<Promise<unknown>> = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([ready, holder]);
    for (let i = 0; i < 8; i++) pending.push(saveRegistrationRetryDraft(limited, draftInput(scope)));
    pending.push(limited.$queryRaw`SELECT 1`);
    const results = await Promise.race([
      Promise.all(pending),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Full-store requests blocked the two-connection pool")), 2_000); }),
    ]);
    expect(results.slice(0, 8)).toEqual(Array(8).fill(null));
    expect(results[8]).toEqual([{ "?column?": 1 }]);
    expect(await db.registrationFormRetryDraft.count({ where: { vendorId: scope.vendorId } })).toBe(CAP);
  } finally {
    clearTimeout(timer); release(); await holder;
    await Promise.allSettled(pending); await limited.$disconnect();
  }
}, 15_000);

it("reclaims expired capacity instead of rejecting a physically full expired store", async () => {
  const scope = await tenantForm("expired");
  await fillRows(scope, CAP, new Date(Date.now() - 1_000));
  const saved = await saveRegistrationRetryDraft(db, draftInput(scope));
  expect(saved).not.toBeNull();
  expect(await readRegistrationRetryDraft(db, { capability: saved!, formId: scope.formId, sourcePath: "/form/synthetic" })).toMatchObject({ answers: { name: "Synthetic" } });
  expect(await db.registrationFormRetryDraft.count({ where: { vendorId: scope.vendorId } })).toBeLessThanOrEqual(CAP);
});

it("sweeps all expired drafts for the scheduled job and leaves live ones", async () => {
  const scope = await tenantForm("sweep");
  await fillRows(scope, 230, new Date(Date.now() - 1_000));
  await fillRows(scope, 3, new Date(Date.now() + 600_000));
  expect(await sweepExpiredRegistrationRetryDrafts(db)).toBeGreaterThanOrEqual(230);
  expect(await db.registrationFormRetryDraft.count({ where: { vendorId: scope.vendorId } })).toBe(3);
});

