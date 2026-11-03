import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encryptSensitiveValue } from "../src/lib/sensitive-data";
import { ENVELOPE_TARGETS, ENVELOPE_WRITERS, EXCLUDED_ENCRYPTED_COLUMNS, envelopeTargetLabel, type EnvelopeRow } from "./sensitive-data-envelope-targets";
import { planTarget, type RawDb } from "./reencrypt-sensitive-data";

const schema = readFileSync(path.join(process.cwd(), "prisma", "schema.prisma"), "utf8");

/** model name -> scalar field names, from the schema text. */
function schemaModels() {
  const models = new Map<string, Set<string>>();
  let current: Set<string> | null = null;
  for (const line of schema.split(/\r?\n/u)) {
    const start = /^model\s+(\w+)\s+\{/u.exec(line);
    if (start) {
      current = new Set();
      models.set(start[1]!, current);
      continue;
    }
    if (/^\}/u.test(line)) {
      current = null;
      continue;
    }
    const field = /^\s+(\w+)\s+\w/u.exec(line);
    if (current && field && !line.trim().startsWith("//") && !line.trim().startsWith("@@")) current.add(field[1]!);
  }
  return models;
}

const models = schemaModels();

/** Production sources under src/, as "<path under src/>" and text. */
function sourceFiles(dir = path.join(process.cwd(), "src"), out: Array<{ path: string; source: string }> = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|tsx)$/u.test(name) && !/\.test\.(ts|tsx)$/u.test(name)) {
      out.push({ path: path.relative(path.join(process.cwd(), "src"), full).split(path.sep).join("/"), source: readFileSync(full, "utf8") });
    }
  }
  return out;
}

/** The top-level arguments of the call whose "(" is at `open`. */
function callArguments(source: string, open: number) {
  const args: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = open + 1;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index]!;
    if (quote) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") quote = char;
    else if (char === "(" || char === "[" || char === "{") depth += 1;
    else if (char === ")" || char === "]" || char === "}") {
      depth -= 1;
      if (depth === 0) {
        args.push(source.slice(start, index).trim());
        return args;
      }
    } else if (char === "," && depth === 1) {
      args.push(source.slice(start, index).trim());
      start = index + 1;
    }
  }
  return args;
}

/** "<file> <purpose argument>" for every envelope-writing call in src/. */
function encryptCallSites() {
  const sites = new Set<string>();
  for (const file of sourceFiles()) {
    if (file.path === "lib/sensitive-data.ts" || file.path === "lib/derived-key-rotation.ts") continue;
    for (const match of file.source.matchAll(/\b(encryptSensitiveValue|encryptWithRotation)\(/gu)) {
      if (/function\s*$/u.test(file.source.slice(Math.max(0, match.index! - 9), match.index!))) continue;
      const purpose = callArguments(file.source, match.index! + match[1]!.length)[1];
      if (purpose !== undefined) sites.add(`${file.path} ${purpose.replace(/\s+/gu, " ")}`);
    }
  }
  return sites;
}

// Synthetic row: every id is 64 hex characters so the strictest binding
// (private chat message ids) accepts it; other fields use safe formats.
const SAMPLE_ID = "0123456789abcdef".repeat(4);
function sampleRow(): EnvelopeRow {
  return new Proxy({} as Record<string, string | number | null>, {
    get(_target, property: string) {
      if (property === "revision") return 3;
      if (property === "channel" || property.endsWith(".channel")) return "email";
      if (property === "source") return "viewer";
      if (property === "event") return "lesson_published";
      if (property === "customerKeyHash" || property.endsWith(".customerKeyHash")) return "k".repeat(43);
      return SAMPLE_ID;
    },
  });
}

beforeEach(() => {
  vi.stubEnv("CSRF_SECRET", "synthetic-envelope-targets-root-" + "0123456789");
  vi.stubEnv("DATA_ENCRYPTION_KEYRING", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("sensitive-data envelope targets", () => {
  it("covers every encrypted column in prisma/schema.prisma or excludes it with a reason", () => {
    const listed = new Set([...ENVELOPE_TARGETS.map(envelopeTargetLabel), ...Object.keys(EXCLUDED_ENCRYPTED_COLUMNS)]);
    const encrypted: string[] = [];
    for (const [model, fields] of models) {
      for (const field of fields) if (/Encrypted|Envelope/u.test(field)) encrypted.push(`${model}.${field}`);
    }
    expect(encrypted.length).toBeGreaterThan(40);
    expect(encrypted.filter((label) => !listed.has(label))).toEqual([]);
    expect(Object.values(EXCLUDED_ENCRYPTED_COLUMNS).every((reason) => reason.length > 10)).toBe(true);
  });

  it("maps every encryptSensitiveValue／encryptWithRotation call in src/ to targets or a non-stored lifetime", () => {
    const sites = encryptCallSites();
    expect(sites.size).toBeGreaterThan(30);
    expect([...sites].filter((site) => !(site in ENVELOPE_WRITERS)), "新的加密呼叫點必須登記在 ENVELOPE_WRITERS").toEqual([]);
    expect(Object.keys(ENVELOPE_WRITERS).filter((site) => !sites.has(site)), "ENVELOPE_WRITERS 中已不存在的呼叫點請移除").toEqual([]);

    const labels = new Set(ENVELOPE_TARGETS.map(envelopeTargetLabel));
    const written = new Set<string>();
    for (const [site, writer] of Object.entries(ENVELOPE_WRITERS)) {
      if ("notStored" in writer) {
        expect(writer.notStored.length, site).toBeGreaterThan(5);
        continue;
      }
      for (const target of writer.targets) {
        expect(labels.has(target), `${site} -> ${target}`).toBe(true);
        written.add(target);
      }
    }
    expect([...labels].filter((label) => !written.has(label)), "每個 target 都要有寫入它的呼叫點").toEqual([]);
  });

  it("names only real tables and columns, each target once", () => {
    const labels = ENVELOPE_TARGETS.map(envelopeTargetLabel);
    expect(new Set(labels).size).toBe(labels.length);
    for (const target of ENVELOPE_TARGETS) {
      const columns = models.get(target.table);
      expect(columns, target.table).toBeDefined();
      for (const column of [target.column, target.idColumn ?? "id", target.scopeColumn, ...target.fields]) {
        expect(columns!.has(column), `${target.table}.${column}`).toBe(true);
      }
      if (target.join) {
        expect(columns!.has(target.join.localColumn)).toBe(true);
        for (const column of ["id", ...target.join.fields]) expect(models.get(target.join.table)!.has(column), column).toBe(true);
      }
      expect(target.codec === "mfa" || typeof target.purposes === "function", envelopeTargetLabel(target)).toBe(true);
    }
  });

  it("builds at least one non-empty purpose for a well-formed row of every envelope target", () => {
    for (const target of ENVELOPE_TARGETS.filter((item) => item.codec !== "mfa")) {
      const purposes = target.purposes!(sampleRow());
      expect(purposes.length, envelopeTargetLabel(target)).toBeGreaterThan(0);
      expect(purposes.every((purpose) => purpose.length > 10), envelopeTargetLabel(target)).toBe(true);
    }
  });

  it("keeps purposes distinct per column of the same table", () => {
    const byTable = new Map<string, Set<string>>();
    for (const target of ENVELOPE_TARGETS.filter((item) => item.codec !== "mfa")) {
      const seen = byTable.get(target.table) ?? new Set<string>();
      // Candidates of one column may coincide here (every sample id is equal).
      for (const purpose of new Set(target.purposes!(sampleRow()))) {
        expect(seen.has(purpose), `${envelopeTargetLabel(target)} reuses ${purpose}`).toBe(false);
        seen.add(purpose);
      }
      byTable.set(target.table, seen);
    }
  });

  it("reads joined fields into the row under their table prefix (fake database, no SQL engine)", async () => {
    const target = ENVELOPE_TARGETS.find((item) => envelopeTargetLabel(item) === "LearnerNotificationVerification.destinationEncryptedEnvelope")!;
    const row = { vendorId: "vendor_1", productId: "product_1", "LearnerNotificationPreference.customerKeyHash": "k".repeat(43), "LearnerNotificationPreference.channel": "email" };
    const [purpose] = target.purposes!({ ...row, id: "verification_1" });
    const envelope = encryptSensitiveValue("destination", purpose!);
    const queries: string[] = [];
    const db = {
      $queryRawUnsafe: vi.fn(async (sql: string) => {
        queries.push(sql);
        return queries.length === 1 ? [{ __id: "verification_1", __value: envelope, ...row }] : [];
      }),
      $transaction: vi.fn(),
    } as unknown as RawDb;

    const plan = await planTarget(db, target, 1);

    expect(plan).toMatchObject({ rows: 1, byKeyId: { legacy: 1 }, unreadable: 0, pending: 0 });
    expect(queries[0]).toContain(`LEFT JOIN "LearnerNotificationPreference" j ON j."id" = t."preferenceId"`);
    expect(queries[0]).toContain(`j."customerKeyHash" AS "LearnerNotificationPreference.customerKeyHash"`);
    expect(queries[1]).toContain(`t."id" > $2`);
  });
});
