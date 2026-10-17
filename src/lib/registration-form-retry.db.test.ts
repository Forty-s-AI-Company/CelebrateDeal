import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveRegistrationRetryDraft, readRegistrationRetryDraft, REGISTRATION_RETRY_TTL_MS, deleteRegistrationRetryDraft } from "./registration-form-retry";

import { assertLocalTestDatabase } from "../../scripts/local-database-safety";

// 使用共用loopback隔離檢查，另拒絕互動開發DB；不綁死本機容器port。
assertLocalTestDatabase("DATABASE_URL", process.env.DATABASE_URL);
const databaseName = decodeURIComponent(new URL(process.env.DATABASE_URL).pathname.slice(1));
if (!/^celebratedeal_(?:test|ci|e2e|wp17_ci|wp18_ci)$/iu.test(databaseName)) {
  throw new Error("Disposable test database required");
}
const db = new PrismaClient();
const ownedForms: string[] = [];
beforeEach(() => { vi.stubEnv("CSRF_SECRET", "wp05-synthetic-encryption-".repeat(3)); vi.stubEnv("JOB_SECRET", ""); });
afterEach(async () => {
  try { await db.registrationFormRetryDraft.deleteMany({ where: { formId: { in: ownedForms } } }); }
  finally { ownedForms.length = 0; vi.unstubAllEnvs(); }
});
afterAll(() => db.$disconnect());

describe("retry draft disposable PostgreSQL", () => {
  it("persists maximum fields encrypted and reads after reconnect before expiry", async () => {
    const formId = `synthetic-${randomUUID()}`; ownedForms.push(formId);
    const sourcePath = "/form/synthetic";
    const now = new Date();
    const answers = Object.fromEntries(Array.from({ length: 32 }, (_, i) => [`field${i}`, "字".repeat(2000)]));
    const capability = await saveRegistrationRetryDraft(db, { formId, sourcePath, answers, liveId: null, status: 503 }, now);
    expect(capability).not.toBeNull();
    const row = await db.registrationFormRetryDraft.findFirstOrThrow({ where: { formId } });
    expect(row.idHash).not.toBe(capability);
    expect(row.encryptedPayload).not.toContain("字");
    expect(row.expiresAt.getTime()).toBe(+now + REGISTRATION_RETRY_TTL_MS);
    await db.$disconnect();
    const restored = await readRegistrationRetryDraft(db, { capability: capability!, formId, sourcePath }, now);
    expect(restored?.answers).toEqual(answers);
    expect(await readRegistrationRetryDraft(db, { capability: capability!, formId: "other-tenant-form", sourcePath }, now)).toBeNull();
    expect(await readRegistrationRetryDraft(db, { capability: capability!, formId, sourcePath }, new Date(+now + REGISTRATION_RETRY_TTL_MS))).toBeNull();
    expect(await db.registrationFormRetryDraft.count({ where: { formId } })).toBe(0);
    const retry = await saveRegistrationRetryDraft(db, { formId, sourcePath, answers, liveId: null, status: 400 }, now);
    expect(retry).not.toBeNull();
    expect(await deleteRegistrationRetryDraft(db, retry!)).toBe(true);
    expect(await readRegistrationRetryDraft(db, { capability: retry!, formId, sourcePath }, now)).toBeNull();
    expect(await db.registrationFormRetryDraft.count({ where: { formId } })).toBe(0);
  });
});

it.each(["ReadCommitted", "RepeatableRead"] as const)("serializes concurrent writes even with %s client default", async (isolationLevel) => {
  const client = new PrismaClient({ transactionOptions: { isolationLevel } });
  try {
  // 證明測試client確實使用不同預設；產品函式須自行覆寫。
  const observed = await client.$transaction((tx) => tx.$queryRaw<Array<{ transaction_isolation: string }>>`SHOW transaction_isolation`);
  expect(observed[0].transaction_isolation).toBe(isolationLevel === "RepeatableRead" ? "repeatable read" : "read committed");
  const formId = `synthetic-cap-${randomUUID()}`; ownedForms.push(formId);
  const existing = await db.registrationFormRetryDraft.count();
  expect(existing).toBeLessThan(127);
  await db.registrationFormRetryDraft.createMany({ data: Array.from({ length: 127 - existing }, () => ({ idHash: randomUUID(), encryptedPayload: "synthetic-cap-fixture", formId, sourcePath: "/form/synthetic", expiresAt: new Date(Date.now() + 600_000) })) });
  const input = { formId, sourcePath: "/form/synthetic", answers: { name: "Synthetic", email: "synthetic@example.test" }, liveId: null, status: 400 as const };
  const results = await Promise.all(Array.from({ length: 8 }, () => saveRegistrationRetryDraft(client, input)));
  expect(results.filter(Boolean)).toHaveLength(1);
  expect(await db.registrationFormRetryDraft.count()).toBe(128);
  } finally { await client.$disconnect(); }
});


it("rejects a full active store without queueing behind its lock or starving the pool", async () => {
  const formId = `synthetic-full-${randomUUID()}`; ownedForms.push(formId);
  const existing = await db.registrationFormRetryDraft.count();
  expect(existing).toBeLessThan(128);
  await db.registrationFormRetryDraft.createMany({ data: Array.from({ length: 128 - existing }, () => ({ idHash: randomUUID(), encryptedPayload: "synthetic-full-fixture", formId, sourcePath: "/form/synthetic", expiresAt: new Date(Date.now() + 600_000) })) });
  const target = new URL(process.env.DATABASE_URL!); target.searchParams.set("connection_limit", "2");
  const limited = new PrismaClient({ datasourceUrl: target.toString() });
  let release!: () => void;
  let acquired!: () => void;
  const unlock = new Promise<void>((resolve) => { release = resolve; });
  const ready = new Promise<void>((resolve) => { acquired = resolve; });
  // 另一連線持有相同鎖，測試拒絕滿額時不需等待該鎖。
  const holder = db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(1760313600, 5)`;
    acquired(); await unlock;
  }, { timeout: 10_000 });
  const pending: Array<Promise<unknown>> = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([ready, holder]);
    for (let i = 0; i < 8; i++) pending.push(saveRegistrationRetryDraft(limited, { formId, sourcePath: "/form/synthetic", answers: { name: "Synthetic" }, liveId: null, status: 400 }));
    pending.push(limited.$queryRaw`SELECT 1`);
    const results = await Promise.race([
      Promise.all(pending),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Full-store requests blocked the two-connection pool")), 2_000); }),
    ]);
    expect(results.slice(0, 8)).toEqual(Array(8).fill(null));
    expect(results[8]).toEqual([{ "?column?": 1 }]);
    expect(await db.registrationFormRetryDraft.count()).toBe(128);
  } finally {
    clearTimeout(timer); release(); await holder;
    await Promise.allSettled(pending); await limited.$disconnect();
  }
}, 15_000);


it("reclaims expired capacity instead of rejecting a physically full expired store", async () => {
  const formId = `synthetic-expired-${randomUUID()}`; ownedForms.push(formId);
  const existing = await db.registrationFormRetryDraft.count();
  expect(existing).toBeLessThan(128);
  await db.registrationFormRetryDraft.createMany({ data: Array.from({ length: 128 - existing }, () => ({ idHash: randomUUID(), encryptedPayload: "synthetic-expired-fixture", formId, sourcePath: "/form/synthetic", expiresAt: new Date(Date.now() - 1_000) })) });
  const saved = await saveRegistrationRetryDraft(db, { formId, sourcePath: "/form/synthetic", answers: { name: "Synthetic" }, liveId: null, status: 400 });
  expect(saved).not.toBeNull();
  expect(await readRegistrationRetryDraft(db, { capability: saved!, formId, sourcePath: "/form/synthetic" })).toMatchObject({ answers: { name: "Synthetic" } });
  expect(await db.registrationFormRetryDraft.count()).toBeLessThanOrEqual(128);
});
