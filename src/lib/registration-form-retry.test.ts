import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { readRegistrationRetryDraft, saveRegistrationRetryDraft, REGISTRATION_RETRY_MAX_ROWS, REGISTRATION_RETRY_MAX_ROWS_PER_VENDOR, REGISTRATION_RETRY_TTL_MS, registrationRetrySourcePath, purgeExpiredRegistrationRetryDrafts, deleteRegistrationRetryDraft, registrationRetryCookieName, registrationRetryCookieOptions, registrationRetrySecureCookies, registrationRetryPayloadBudget, sweepExpiredRegistrationRetryDrafts } from "./registration-form-retry";

type Row = { idHash: string; vendorId: string; encryptedPayload: string; sourcePath: string; formId: string; expiresAt: Date };
type CountWhere = { vendorId?: string; expiresAt?: { gt: Date } };
const rows = new Map<string, Row>();
const table = {
  count: vi.fn(async ({ where }: { where?: CountWhere } = {}) => [...rows.values()].filter((row) => (!where?.vendorId || row.vendorId === where.vendorId) && (!where?.expiresAt || row.expiresAt > where.expiresAt.gt)).length),
  create: vi.fn(async ({ data }: { data: Row }) => { rows.set(data.idHash, data); return data; }),
  findUnique: vi.fn(async ({ where }: { where: { idHash: string } }) => rows.get(where.idHash) ?? null),
  findMany: vi.fn(async ({ where, take }: { where: { expiresAt: { lte: Date } }; take: number }) => [...rows.values()].filter((row) => row.expiresAt <= where.expiresAt.lte).slice(0, take).map(({ idHash }) => ({ idHash }))),
  deleteMany: vi.fn(async ({ where }: { where: { idHash: { in: string[] } | string; expiresAt?: { lte: Date } } }) => {
    let count = 0;
    for (const id of (typeof where.idHash === "string" ? [where.idHash] : where.idHash.in)) { const row = rows.get(id); if (row && (!where.expiresAt || row.expiresAt <= where.expiresAt.lte)) { rows.delete(id); count++; } }
    return { count };
  }),
};
const lockAcquired = { value: true };
const tx = { registrationFormRetryDraft: table, $queryRaw: vi.fn(async () => [{ acquired: lockAcquired.value }]) };
const db = { ...tx, $transaction: async (work: (client: typeof tx) => Promise<unknown>) => work(tx) } as unknown as PrismaClient;
const now = new Date("2026-10-12T00:00:00Z");
const vendorId = "synthetic-vendor";
const draft = { formId: "synthetic-form", sourcePath: "/lp/synthetic/registration", answers: { name: "合成姓名", email: "synthetic@example.test" }, liveId: "synthetic-live", status: 400 as const };
const read = (capability: string, extra = {}, at = now) => readRegistrationRetryDraft(db, { capability, formId: draft.formId, sourcePath: draft.sourcePath, ...extra }, at);
beforeEach(() => { rows.clear(); lockAcquired.value = true; vi.clearAllMocks(); vi.stubEnv("CSRF_SECRET", "synthetic-only-key-".repeat(4)); vi.stubEnv("JOB_SECRET", ""); });
afterEach(() => vi.unstubAllEnvs());

describe("registration retry encrypted storage", () => {
  it("round trips without storing capability or plaintext fields", async () => {
    const capability = await saveRegistrationRetryDraft(db, { ...draft, vendorId }, now);
    expect(capability).not.toBeNull();
    const stored = [...rows.values()][0];
    expect(JSON.stringify(stored)).not.toContain(capability);
    expect(JSON.stringify(stored)).not.toContain(draft.answers.email);
    expect(JSON.stringify(stored)).not.toContain(draft.answers.name);
    expect(await read(capability!)).toEqual(draft);
  });
  it("retains all 32 maximum-length unicode fields", async () => {
    const answers = Object.fromEntries(Array.from({ length: 32 }, (_, i) => [`field${i}`, "字".repeat(2000)]));
    const capability = await saveRegistrationRetryDraft(db, { ...draft, vendorId, answers }, now);
    expect(capability).not.toBeNull();
    expect((await read(capability!))?.answers).toEqual(answers);
  });
  it.each([{ formId: "other-tenant-form" }, { sourcePath: "/form/other" }])("does not expose another form or source", async (binding) => {
    const capability = await saveRegistrationRetryDraft(db, { ...draft, vendorId }, now);
    expect(await read(capability!, binding)).toBeNull();
  });
  it("expires exactly at TTL while allowing a read just before expiry", async () => {
    const early = await saveRegistrationRetryDraft(db, { ...draft, vendorId }, now);
    const late = await saveRegistrationRetryDraft(db, { ...draft, vendorId }, now);
    expect(await read(early!, {}, new Date(+now + REGISTRATION_RETRY_TTL_MS - 1))).toEqual(draft);
    expect(await read(late!, {}, new Date(+now + REGISTRATION_RETRY_TTL_MS))).toBeNull();
    expect(rows.size).toBe(0);
  });
  it("rejects a forged stored expiry and ciphertext corruption", async () => {
    const capability = await saveRegistrationRetryDraft(db, { ...draft, vendorId }, now);
    const row = [...rows.values()][0];
    row.expiresAt = new Date(+row.expiresAt + 1);
    expect(await read(capability!)).toBeNull();
    row.expiresAt = new Date(+row.expiresAt - 1);
    row.encryptedPayload = row.encryptedPayload.slice(0, 15) + "!" + row.encryptedPayload.slice(16);
    expect(await read(capability!)).toBeNull();
  });
  it("fails closed with missing encryption configuration", async () => {
    vi.stubEnv("CSRF_SECRET", "");
    expect(await saveRegistrationRetryDraft(db, { ...draft, vendorId }, now)).toBeNull();
    expect(table.create).not.toHaveBeenCalled();
  });
  it("fails closed when persistence fails", async () => {
    table.create.mockRejectedValueOnce(new Error("synthetic storage failure"));
    expect(await saveRegistrationRetryDraft(db, { ...draft, vendorId }, now)).toBeNull();
    table.findUnique.mockRejectedValueOnce(new Error("synthetic read failure"));
    expect(await read("A".repeat(43))).toBeNull();
  });
  it("rejects oversized, reserved and excessive fields before persistence", async () => {
    for (const answers of [{ name: "x".repeat(2001) }, { formId: "wrong" }, Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`field${i}`, "x"]))]) {
      expect(await saveRegistrationRetryDraft(db, { ...draft, vendorId, answers }, now)).toBeNull();
    }
    expect(table.create).not.toHaveBeenCalled();
  });
  it.each(["//evil.test/form/x", "/form/x?email=synthetic", "/form/x#value", "/form/../admin", "/form/%2e%2e", "https://example.test/form/x", "/admin/x"])("rejects unsafe source %s", (value) => {
    expect(registrationRetrySourcePath(value)).toBeNull();
  });
  it("bounds cleanup and leaves active drafts alone", async () => {
    for (let i = 0; i < 105; i++) rows.set(String(i), { idHash: String(i), vendorId, encryptedPayload: "unused", formId: draft.formId, sourcePath: draft.sourcePath, expiresAt: now });
    rows.set("active", { idHash: "active", vendorId, encryptedPayload: "unused", formId: draft.formId, sourcePath: draft.sourcePath, expiresAt: new Date(+now + 1) });
    expect(await purgeExpiredRegistrationRetryDrafts(db, now)).toBe(100);
    expect(rows.has("active")).toBe(true);
    expect(rows.size).toBe(6);
  });
});

it("retains schema-maximum escape-heavy values", async () => {
  const answers = Object.fromEntries(Array.from({ length: 32 }, (_, i) => [`field${i}`, "\u0001".repeat(2000)]));
  const maximumDraft = { ...draft, answers, formId: "f".repeat(128), liveId: "l".repeat(128), sourcePath: "/form/" + "s".repeat(2042) };
  const capability = await saveRegistrationRetryDraft(db, { ...maximumDraft, vendorId }, now);
  expect(capability).not.toBeNull();
  expect(await read(capability!, { formId: maximumDraft.formId, sourcePath: maximumDraft.sourcePath })).toEqual(maximumDraft);
});
it("deletes successfully completed drafts idempotently", async () => {
  const capability = await saveRegistrationRetryDraft(db, { ...draft, vendorId }, now);
  expect(await deleteRegistrationRetryDraft(db, capability!)).toBe(true);
  expect(await read(capability!)).toBeNull();
  expect(rows.size).toBe(0);
  expect(await deleteRegistrationRetryDraft(db, capability!)).toBe(true);
  expect(await deleteRegistrationRetryDraft(db, "invalid")).toBe(false);
});
it("rejects ciphertext transplanted between valid rows", async () => {
  const first = await saveRegistrationRetryDraft(db, { ...draft, vendorId }, now);
  const second = await saveRegistrationRetryDraft(db, { ...draft, vendorId }, now);
  const [a, b] = [...rows.values()];
  [a.encryptedPayload, b.encryptedPayload] = [b.encryptedPayload, a.encryptedPayload];
  expect(await read(first!)).toBeNull(); expect(await read(second!)).toBeNull();
});
it("rejects rewritten plain source/form bindings", async () => {
  const capability = await saveRegistrationRetryDraft(db, { ...draft, vendorId }, now);
  const row = [...rows.values()][0]; row.formId = "other-form"; row.sourcePath = "/form/other";
  expect(await read(capability!, { formId: row.formId, sourcePath: row.sourcePath })).toBeNull();
});
it.each([2, 3])("rejects valid-base64 bit flip in envelope part %i", async (part) => {
  const capability = await saveRegistrationRetryDraft(db, { ...draft, vendorId }, now);
  const row = [...rows.values()][0]; const parts = row.encryptedPayload.split(".");
  const bytes = Buffer.from(parts[part], "base64url"); bytes[0] ^= 1;
  parts[part] = bytes.toString("base64url"); row.encryptedPayload = parts.join(".");
  expect(await read(capability!)).toBeNull();
});
it("uses host-prefixed secure cookies without a Domain", () => {
  expect(registrationRetryCookieName(true)).toBe("__Host-celebratedeal_registration_retry");
  expect(registrationRetryCookieOptions(true)).toMatchObject({ secure: true, path: "/", httpOnly: true });
  expect(registrationRetryCookieOptions(true)).not.toHaveProperty("domain");
  expect(registrationRetryCookieName(false)).not.toMatch(/^__Host-/);
});

it("refuses writes at the per-tenant active row cap without taking the lock", async () => {
  for (let i = 0; i < REGISTRATION_RETRY_MAX_ROWS_PER_VENDOR; i++) rows.set(String(i), { idHash: String(i), vendorId, encryptedPayload: "synthetic", formId: draft.formId, sourcePath: draft.sourcePath, expiresAt: new Date(+now + 60_000) });
  expect(await saveRegistrationRetryDraft(db, { ...draft, vendorId }, now)).toBeNull();
  expect(rows.size).toBe(REGISTRATION_RETRY_MAX_ROWS_PER_VENDOR);
  expect(tx.$queryRaw).not.toHaveBeenCalled();
  expect(table.create).not.toHaveBeenCalled();
});

it.each(["http://127.0.0.1:31026", "https://app.example.test"])("uses the same cookie mode for configured origin %s", (origin) => {
 vi.stubEnv("NEXT_PUBLIC_APP_URL", origin);
 expect(registrationRetrySecureCookies("internal:3000")).toBe(origin.startsWith("https:"));
 expect(registrationRetrySecureCookies("public.example.test")).toBe(origin.startsWith("https:"));
});

it("encrypts attribution with the same form/path/expiry binding and restores it", async () => {
  const attribution = { referralCode: "synthetic-ref", shareCode: `tls1.${"a".repeat(32)}`, landingPageId: "synthetic-page" };
  const capability = await saveRegistrationRetryDraft(db, { ...draft, vendorId, attribution }, now);
  expect(capability).not.toBeNull();
  expect(JSON.stringify([...rows.values()])).not.toContain(attribution.referralCode);
  expect(JSON.stringify([...rows.values()])).not.toContain(attribution.shareCode);
  expect(await read(capability!)).toEqual({ ...draft, attribution });
  expect(await read(capability!, { sourcePath: "/lp/other" })).toBeNull();
  expect(await saveRegistrationRetryDraft(db, { ...draft, vendorId, attribution: { shareCode: "invalid" } }, now)).toBeNull();
});

it("keeps another tenant's capacity available when one tenant is full", async () => {
  for (let i = 0; i < REGISTRATION_RETRY_MAX_ROWS_PER_VENDOR; i++) rows.set(`full-${i}`, { idHash: `full-${i}`, vendorId: "flooded-vendor", encryptedPayload: "synthetic", formId: "flooded-form", sourcePath: draft.sourcePath, expiresAt: new Date(+now + 60_000) });
  expect(await saveRegistrationRetryDraft(db, { ...draft, vendorId: "flooded-vendor" }, now)).toBeNull();
  const capability = await saveRegistrationRetryDraft(db, { ...draft, vendorId }, now);
  expect(capability).not.toBeNull();
  expect(await read(capability!)).toEqual(draft);
});

it("refuses writes at the global soft cap", async () => {
  for (let i = 0; i < REGISTRATION_RETRY_MAX_ROWS; i++) rows.set(`g-${i}`, { idHash: `g-${i}`, vendorId: `vendor-${i % 64}`, encryptedPayload: "synthetic", formId: "f", sourcePath: draft.sourcePath, expiresAt: new Date(+now + 60_000) });
  expect(await saveRegistrationRetryDraft(db, { ...draft, vendorId }, now)).toBeNull();
  expect(table.create).not.toHaveBeenCalled();
});

it("stores the server tenant on the row and inside the authenticated envelope", async () => {
  const capability = await saveRegistrationRetryDraft(db, { ...draft, vendorId }, now);
  const row = [...rows.values()][0];
  expect(row.vendorId).toBe(vendorId);
  expect(tx.$queryRaw).toHaveBeenCalledOnce();
  // A row re-labelled to another tenant no longer authenticates.
  row.vendorId = "other-vendor";
  expect(await read(capability!)).toBeNull();
  row.vendorId = vendorId;
  const restored = await read(capability!);
  expect(restored).toEqual(draft);
  expect(restored).not.toHaveProperty("vendorId");
});

it.each(["", "v".repeat(129)])("rejects an invalid tenant identifier %#", async (invalid) => {
  expect(await saveRegistrationRetryDraft(db, { ...draft, vendorId: invalid }, now)).toBeNull();
  expect(table.create).not.toHaveBeenCalled();
});

it("is single use: a prefill read deletes the ciphertext", async () => {
  const capability = await saveRegistrationRetryDraft(db, { ...draft, vendorId }, now);
  expect(await read(capability!)).toEqual(draft);
  expect(rows.size).toBe(0);
  expect(await read(capability!)).toBeNull();
});

it("does not consume a draft on a binding mismatch", async () => {
  const capability = await saveRegistrationRetryDraft(db, { ...draft, vendorId }, now);
  expect(await read(capability!, { formId: "other-form" })).toBeNull();
  expect(await read(capability!)).toEqual(draft);
});

it("reports a contended tenant lock as unavailable instead of waiting", async () => {
  lockAcquired.value = false;
  expect(await saveRegistrationRetryDraft(db, { ...draft, vendorId }, now)).toBeNull();
  expect(tx.$queryRaw).toHaveBeenCalledOnce();
  expect(table.create).not.toHaveBeenCalled();
});

it("ignores expired rows when counting a tenant's capacity inside the lock", async () => {
  for (let i = 0; i < REGISTRATION_RETRY_MAX_ROWS_PER_VENDOR; i++) rows.set(`old-${i}`, { idHash: `old-${i}`, vendorId, encryptedPayload: "synthetic", formId: draft.formId, sourcePath: draft.sourcePath, expiresAt: new Date(+now - 1) });
  // Purge only reclaims 100 per call; the remaining 28 expired rows must not count.
  expect(await saveRegistrationRetryDraft(db, { ...draft, vendorId }, now)).not.toBeNull();
});

it.each([
  ["/form/夏季-新品-live", "/form/夏季-新品-live"],
  ["/form/%E5%A4%8F%E5%AD%A3-%E6%96%B0%E5%93%81-live", "/form/夏季-新品-live"],
  ["/p/團隊-頁面", "/p/團隊-頁面"],
])("accepts CJK slugs in one canonical decoded form: %s", (value, canonical) => {
  expect(registrationRetrySourcePath(value)).toBe(canonical);
});

it.each(["/form/%2F", "/form/a%2Fb", "/form/%25E5", "/form/%E5%A4", "/form/a b", "/form/a%20b", "/form/a.b", "/form/%2e%2e"])("rejects encoded separators and non-slug characters: %s", (value) => {
  expect(registrationRetrySourcePath(value)).toBeNull();
});

it("stores and reads a CJK path draft whichever encoding the caller passes", async () => {
  const capability = await saveRegistrationRetryDraft(db, { ...draft, vendorId, sourcePath: "/form/%E5%A4%8F%E5%AD%A3" }, now);
  expect([...rows.values()][0].sourcePath).toBe("/form/夏季");
  expect(await read(capability!, { sourcePath: "/form/夏季" })).toEqual({ ...draft, sourcePath: "/form/夏季" });
});

it("enforces the caller's per-form payload budget", async () => {
  expect(await saveRegistrationRetryDraft(db, { ...draft, vendorId, answers: { name: "x".repeat(2_000) }, maxPayloadBytes: 1_024 }, now)).toBeNull();
  expect(table.create).not.toHaveBeenCalled();
  expect(await saveRegistrationRetryDraft(db, { ...draft, vendorId, maxPayloadBytes: registrationRetryPayloadBudget([{ key: "name", type: "text" }, { key: "email", type: "email" }]) }, now)).not.toBeNull();
});

it("derives the budget from the form's real fields with the absolute ceiling", () => {
  const two = registrationRetryPayloadBudget([{ key: "name", type: "text" }, { key: "email", type: "email" }]);
  expect(two).toBeLessThan(40_000);
  const maximum = registrationRetryPayloadBudget(Array.from({ length: 32 }, (_, i) => ({ key: `field${i}`, type: "text" as const })));
  expect(maximum).toBeLessThanOrEqual(400_000);
});

it("sweeps expired drafts in bounded batches for the scheduled job", async () => {
  for (let i = 0; i < 250; i++) rows.set(`s-${i}`, { idHash: `s-${i}`, vendorId, encryptedPayload: "synthetic", formId: draft.formId, sourcePath: draft.sourcePath, expiresAt: now });
  rows.set("live", { idHash: "live", vendorId, encryptedPayload: "synthetic", formId: draft.formId, sourcePath: draft.sourcePath, expiresAt: new Date(+now + 1) });
  expect(await sweepExpiredRegistrationRetryDrafts(db, now)).toBe(250);
  expect([...rows.keys()]).toEqual(["live"]);
  for (let i = 0; i < 250; i++) rows.set(`t-${i}`, { idHash: `t-${i}`, vendorId, encryptedPayload: "synthetic", formId: draft.formId, sourcePath: draft.sourcePath, expiresAt: now });
  expect(await sweepExpiredRegistrationRetryDrafts(db, now, 150)).toBe(200);
});
