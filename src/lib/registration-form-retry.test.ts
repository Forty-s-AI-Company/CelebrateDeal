import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { readRegistrationRetryDraft, saveRegistrationRetryDraft, REGISTRATION_RETRY_TTL_MS, registrationRetrySourcePath, purgeExpiredRegistrationRetryDrafts, deleteRegistrationRetryDraft, registrationRetryCookieName, registrationRetryCookieOptions, registrationRetrySecureCookies } from "./registration-form-retry";

type Row = { idHash: string; encryptedPayload: string; sourcePath: string; formId: string; expiresAt: Date };
const rows = new Map<string, Row>();
const table = {
  count: vi.fn(async () => rows.size),
  create: vi.fn(async ({ data }: { data: Row }) => { rows.set(data.idHash, data); return data; }),
  findUnique: vi.fn(async ({ where }: { where: { idHash: string } }) => rows.get(where.idHash) ?? null),
  findMany: vi.fn(async ({ where, take }: { where: { expiresAt: { lte: Date } }; take: number }) => [...rows.values()].filter((row) => row.expiresAt <= where.expiresAt.lte).slice(0, take).map(({ idHash }) => ({ idHash }))),
  deleteMany: vi.fn(async ({ where }: { where: { idHash: { in: string[] } | string; expiresAt?: { lte: Date } } }) => {
    let count = 0;
    for (const id of (typeof where.idHash === "string" ? [where.idHash] : where.idHash.in)) { const row = rows.get(id); if (row && (!where.expiresAt || row.expiresAt <= where.expiresAt.lte)) { rows.delete(id); count++; } }
    return { count };
  }),
};
const tx = { registrationFormRetryDraft: table, $executeRaw: vi.fn(async () => 0) };
const db = { ...tx, $transaction: async (work: (client: typeof tx) => Promise<unknown>) => work(tx) } as unknown as PrismaClient;
const now = new Date("2026-10-12T00:00:00Z");
const draft = { formId: "synthetic-form", sourcePath: "/lp/synthetic/registration", answers: { name: "合成姓名", email: "synthetic@example.test" }, liveId: "synthetic-live", status: 400 as const };
const read = (capability: string, extra = {}, at = now) => readRegistrationRetryDraft(db, { capability, formId: draft.formId, sourcePath: draft.sourcePath, ...extra }, at);
beforeEach(() => { rows.clear(); vi.clearAllMocks(); vi.stubEnv("CSRF_SECRET", "synthetic-only-key-".repeat(4)); vi.stubEnv("JOB_SECRET", ""); });
afterEach(() => vi.unstubAllEnvs());

describe("registration retry encrypted storage", () => {
  it("round trips without storing capability or plaintext fields", async () => {
    const capability = await saveRegistrationRetryDraft(db, draft, now);
    expect(capability).not.toBeNull();
    const stored = [...rows.values()][0];
    expect(JSON.stringify(stored)).not.toContain(capability);
    expect(JSON.stringify(stored)).not.toContain(draft.answers.email);
    expect(JSON.stringify(stored)).not.toContain(draft.answers.name);
    expect(await read(capability!)).toEqual(draft);
  });
  it("retains all 32 maximum-length unicode fields", async () => {
    const answers = Object.fromEntries(Array.from({ length: 32 }, (_, i) => [`field${i}`, "字".repeat(2000)]));
    const capability = await saveRegistrationRetryDraft(db, { ...draft, answers }, now);
    expect(capability).not.toBeNull();
    expect((await read(capability!))?.answers).toEqual(answers);
  });
  it.each([{ formId: "other-tenant-form" }, { sourcePath: "/form/other" }])("does not expose another form or source", async (binding) => {
    const capability = await saveRegistrationRetryDraft(db, draft, now);
    expect(await read(capability!, binding)).toBeNull();
  });
  it("expires exactly at TTL while allowing refresh before expiry", async () => {
    const capability = await saveRegistrationRetryDraft(db, draft, now);
    expect(await read(capability!, {}, new Date(+now + REGISTRATION_RETRY_TTL_MS - 1))).toEqual(draft);
    expect(await read(capability!, {}, new Date(+now + REGISTRATION_RETRY_TTL_MS))).toBeNull();
    expect(rows.size).toBe(0);
  });
  it("rejects a forged stored expiry and ciphertext corruption", async () => {
    const capability = await saveRegistrationRetryDraft(db, draft, now);
    const row = [...rows.values()][0];
    row.expiresAt = new Date(+row.expiresAt + 1);
    expect(await read(capability!)).toBeNull();
    row.expiresAt = new Date(+row.expiresAt - 1);
    row.encryptedPayload = row.encryptedPayload.slice(0, 15) + "!" + row.encryptedPayload.slice(16);
    expect(await read(capability!)).toBeNull();
  });
  it("fails closed with missing encryption configuration", async () => {
    vi.stubEnv("CSRF_SECRET", "");
    expect(await saveRegistrationRetryDraft(db, draft, now)).toBeNull();
    expect(table.create).not.toHaveBeenCalled();
  });
  it("fails closed when persistence fails", async () => {
    table.create.mockRejectedValueOnce(new Error("synthetic storage failure"));
    expect(await saveRegistrationRetryDraft(db, draft, now)).toBeNull();
    table.findUnique.mockRejectedValueOnce(new Error("synthetic read failure"));
    expect(await read("A".repeat(43))).toBeNull();
  });
  it("rejects oversized, reserved and excessive fields before persistence", async () => {
    for (const answers of [{ name: "x".repeat(2001) }, { formId: "wrong" }, Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`field${i}`, "x"]))]) {
      expect(await saveRegistrationRetryDraft(db, { ...draft, answers }, now)).toBeNull();
    }
    expect(table.create).not.toHaveBeenCalled();
  });
  it.each(["//evil.test/form/x", "/form/x?email=synthetic", "/form/x#value", "/form/../admin", "/form/%2e%2e", "https://example.test/form/x", "/admin/x"])("rejects unsafe source %s", (value) => {
    expect(registrationRetrySourcePath(value)).toBeNull();
  });
  it("bounds cleanup and leaves active drafts alone", async () => {
    for (let i = 0; i < 105; i++) rows.set(String(i), { idHash: String(i), encryptedPayload: "unused", formId: draft.formId, sourcePath: draft.sourcePath, expiresAt: now });
    rows.set("active", { idHash: "active", encryptedPayload: "unused", formId: draft.formId, sourcePath: draft.sourcePath, expiresAt: new Date(+now + 1) });
    expect(await purgeExpiredRegistrationRetryDrafts(db, now)).toBe(100);
    expect(rows.has("active")).toBe(true);
    expect(rows.size).toBe(6);
  });
});

it("retains schema-maximum escape-heavy values", async () => {
  const answers = Object.fromEntries(Array.from({ length: 32 }, (_, i) => [`field${i}`, "\u0001".repeat(2000)]));
  const maximumDraft = { ...draft, answers, formId: "f".repeat(128), liveId: "l".repeat(128), sourcePath: "/form/" + "s".repeat(2042) };
  const capability = await saveRegistrationRetryDraft(db, maximumDraft, now);
  expect(capability).not.toBeNull();
  expect(await read(capability!, { formId: maximumDraft.formId, sourcePath: maximumDraft.sourcePath })).toEqual(maximumDraft);
});
it("deletes successfully completed drafts idempotently", async () => {
  const capability = await saveRegistrationRetryDraft(db, draft, now);
  expect(await deleteRegistrationRetryDraft(db, capability!)).toBe(true);
  expect(await read(capability!)).toBeNull();
  expect(rows.size).toBe(0);
  expect(await deleteRegistrationRetryDraft(db, capability!)).toBe(true);
  expect(await deleteRegistrationRetryDraft(db, "invalid")).toBe(false);
});
it("rejects ciphertext transplanted between valid rows", async () => {
  const first = await saveRegistrationRetryDraft(db, draft, now);
  const second = await saveRegistrationRetryDraft(db, draft, now);
  const [a, b] = [...rows.values()];
  [a.encryptedPayload, b.encryptedPayload] = [b.encryptedPayload, a.encryptedPayload];
  expect(await read(first!)).toBeNull(); expect(await read(second!)).toBeNull();
});
it("rejects rewritten plain source/form bindings", async () => {
  const capability = await saveRegistrationRetryDraft(db, draft, now);
  const row = [...rows.values()][0]; row.formId = "other-form"; row.sourcePath = "/form/other";
  expect(await read(capability!, { formId: row.formId, sourcePath: row.sourcePath })).toBeNull();
});
it.each([2, 3])("rejects valid-base64 bit flip in envelope part %i", async (part) => {
  const capability = await saveRegistrationRetryDraft(db, draft, now);
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

it("refuses writes at the global physical row cap", async () => {
  for (let i = 0; i < 128; i++) rows.set(String(i), { idHash: String(i), encryptedPayload: "synthetic", formId: draft.formId, sourcePath: draft.sourcePath, expiresAt: new Date(+now + 60_000) });
  expect(await saveRegistrationRetryDraft(db, draft, now)).toBeNull();
  expect(rows.size).toBe(128);
  expect(tx.$executeRaw).not.toHaveBeenCalled();
  expect(table.create).not.toHaveBeenCalled();
});

it.each(["http://127.0.0.1:31026", "https://app.example.test"])("uses the same cookie mode for configured origin %s", (origin) => {
 vi.stubEnv("NEXT_PUBLIC_APP_URL", origin);
 expect(registrationRetrySecureCookies("internal:3000")).toBe(origin.startsWith("https:"));
 expect(registrationRetrySecureCookies("public.example.test")).toBe(origin.startsWith("https:"));
});

it("encrypts attribution with the same form/path/expiry binding and restores it", async () => {
  const attribution = { referralCode: "synthetic-ref", shareCode: `tls1.${"a".repeat(32)}`, landingPageId: "synthetic-page" };
  const capability = await saveRegistrationRetryDraft(db, { ...draft, attribution }, now);
  expect(capability).not.toBeNull();
  expect(JSON.stringify([...rows.values()])).not.toContain(attribution.referralCode);
  expect(JSON.stringify([...rows.values()])).not.toContain(attribution.shareCode);
  expect(await read(capability!)).toEqual({ ...draft, attribution });
  expect(await read(capability!, { sourcePath: "/lp/other" })).toBeNull();
  expect(await saveRegistrationRetryDraft(db, { ...draft, attribution: { shareCode: "invalid" } }, now)).toBeNull();
});
