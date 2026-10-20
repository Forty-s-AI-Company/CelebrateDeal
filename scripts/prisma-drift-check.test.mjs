import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  ALLOWLIST_SCHEMA,
  classifyShadowDatabaseUrl,
  compareDrift,
  parseDiffStatements,
  runPrismaDiff,
  staleMessage,
  validateAllowlist,
} from "./prisma-drift-check.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const allowlist = JSON.parse(fs.readFileSync(path.join(root, "scripts", "prisma-drift-allowlist.json"), "utf8"));

function list(...statements) {
  return { schemaVersion: ALLOWLIST_SCHEMA, entries: statements.map((statement) => ({ statement, category: "synthetic", reason: "synthetic" })) };
}

test("accepts only dedicated loopback shadow databases and never echoes the URL", () => {
  assert.deepEqual(classifyShadowDatabaseUrl("postgresql://u:p@127.0.0.1:5432/celebratedeal_shadow_ci?schema=public"), { safe: true, database: "celebratedeal_shadow_ci" });
  assert.deepEqual(classifyShadowDatabaseUrl("postgres://u:p@localhost:5433/celebratedeal_e2e"), { safe: true, database: "celebratedeal_e2e" });
  assert.deepEqual(classifyShadowDatabaseUrl(undefined), { safe: false, category: "missing" });
  assert.deepEqual(classifyShadowDatabaseUrl("not a url"), { safe: false, category: "invalid-url" });
  assert.deepEqual(classifyShadowDatabaseUrl("mysql://u:p@127.0.0.1/celebratedeal_shadow_ci"), { safe: false, category: "unsupported-protocol" });
  assert.deepEqual(classifyShadowDatabaseUrl("postgresql://u:p@db.example.test:5432/celebratedeal_shadow_ci"), { safe: false, category: "non-loopback" }); // secret-scan: allow-test-fixture
  // The CI/test databases hold real fixtures; Prisma would wipe them.
  for (const name of ["celebratedeal_ci", "celebratedeal_test", "celebratedeal_dev", "postgres"]) {
    assert.deepEqual(classifyShadowDatabaseUrl(`postgresql://u:p@127.0.0.1:5432/${name}`), { safe: false, category: "not-a-dedicated-shadow-database" }); // secret-scan: allow-test-fixture
  }
});

test("parses migrate diff output into normalized statements", () => {
  const script = [
    "-- DropIndex",
    "DROP INDEX \"FormSubmission_email_trgm_idx\";",
    "",
    "-- AddForeignKey",
    "ALTER TABLE \"A\" ADD CONSTRAINT \"A_b_fkey\"",
    "  FOREIGN KEY (\"b\") REFERENCES \"B\"(\"id\");",
    "",
    "",
  ].join("\r\n");
  assert.deepEqual(parseDiffStatements(script), [
    "DROP INDEX \"FormSubmission_email_trgm_idx\";",
    "ALTER TABLE \"A\" ADD CONSTRAINT \"A_b_fkey\" FOREIGN KEY (\"b\") REFERENCES \"B\"(\"id\");",
  ]);
  assert.deepEqual(parseDiffStatements("-- This is an empty migration.\n"), []);
});

test("passes only when the diff equals the allowlist", () => {
  assert.deepEqual(compareDrift(["DROP INDEX \"a\";"], list("DROP INDEX \"a\";")), { ok: true, unexpected: [], stale: [], matched: 1 });
  assert.deepEqual(compareDrift(["DROP INDEX \"a\";", "DROP INDEX \"new\";"], list("DROP INDEX \"a\";")), {
    ok: false, unexpected: ["DROP INDEX \"new\";"], stale: [], matched: 1,
  });
  // An allowlisted object vanishing from the diff means a migration dropped
  // it (or the schema now declares it); either way the PR must say so.
  assert.deepEqual(compareDrift([], list("DROP INDEX \"a\";")), { ok: false, unexpected: [], stale: ["DROP INDEX \"a\";"], matched: 0 });
});

test("rejects malformed allowlists", () => {
  assert.throws(() => validateAllowlist({ schemaVersion: "other", entries: [] }), /schemaVersion/u);
  assert.throws(() => validateAllowlist({ schemaVersion: ALLOWLIST_SCHEMA, entries: [{ statement: "x" }] }), /category and reason/u);
  assert.throws(() => validateAllowlist(list("x", "x")), /Duplicate/u);
});

test("the committed allowlist is well formed and covers the B04-04 hazards", () => {
  const entries = validateAllowlist(allowlist);
  const statements = entries.map((entry) => entry.statement);
  assert.equal(new Set(statements).size, statements.length);
  for (const statement of statements) assert.equal(parseDiffStatements(statement)[0], statement, "statements must already be normalized");
  for (const index of ["FormSubmission_email_trgm_idx", "FormSubmission_name_trgm_idx", "FormSubmission_phone_trgm_idx"]) {
    assert.ok(entries.some((entry) => entry.category === "trgm_gin_index" && entry.statement === `DROP INDEX "${index}";`));
  }
  assert.ok(statements.includes("DROP INDEX \"CommerceOrder_vendorId_automationCustomerKeyHash_status_idx\";"));
  assert.ok(statements.includes("ALTER INDEX \"LiveMediaSession_scope_key\" RENAME TO \"LiveMediaSession_vendorId_liveId_principal_direction_key\";"));
  assert.ok(statements.includes("ALTER INDEX \"PlatformReferralCommissionLedgerEntry_commissionId_createdAt_id\" RENAME TO \"prc_ledger_comm_created_idx\";"));
  const counts = {};
  for (const entry of entries) counts[entry.category] = (counts[entry.category] ?? 0) + 1;
  assert.deepEqual(counts, allowlist.baseline.counts);
  assert.deepEqual(allowlist.notComparedByPrismaDiff.partialUniqueIndexes, [
    "ConsultationBooking_active_slot_key",
    "LiveQuestion_one_spotlight_per_live_key",
    "PostPurchaseCredit_vendorId_sourceOrderId_active_key",
    "SettlementAdjustmentRequest_one_pending_per_settlement",
    "TeamMembershipRelationship_one_active_upline",
  ]);
});

test("invokes prisma migrate diff with every URL pinned to the shadow database", () => {
  const calls = [];
  const shadowUrl = "postgresql://u:p@127.0.0.1:5432/celebratedeal_shadow_ci?schema=public";
  const output = runPrismaDiff({
    root,
    shadowUrl,
    spawn: (command, args, options) => {
      calls.push({ command, args, options });
      return { status: 0, stdout: "-- DropIndex\nDROP INDEX \"a\";\n" };
    },
  });
  assert.equal(output, "-- DropIndex\nDROP INDEX \"a\";\n");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, process.execPath);
  assert.deepEqual(calls[0].args.slice(1), [
    "migrate", "diff",
    "--from-migrations", "prisma/migrations",
    "--to-schema-datamodel", "prisma/schema.prisma",
    "--shadow-database-url", shadowUrl,
    "--script",
  ]);
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.env.DATABASE_URL, shadowUrl);
  assert.equal(calls[0].options.env.DIRECT_URL, shadowUrl);

  assert.throws(() => runPrismaDiff({ root, shadowUrl, spawn: () => ({ status: 1, stdout: "" }) }), /exit code 1/u);
  assert.throws(() => runPrismaDiff({ root, shadowUrl, spawn: () => ({ error: new Error("spawn"), status: null, stdout: "" }) }), /exit code unknown/u);
});

test("tells developers not to delete protected allowlist entries when they disappear", () => {
  const fk = "ALTER TABLE \"Live\" DROP CONSTRAINT \"Live_vendorId_formId_fkey\";";
  const trgm = "DROP INDEX \"FormSubmission_email_trgm_idx\";";
  const rename = allowlist.entries.find((entry) => entry.category === "index_name_mismatch").statement;
  assert.match(staleMessage(fk, allowlist), /protected foreign_key_missing_in_schema entry disappeared.*do NOT delete the allowlist entry/u);
  assert.match(staleMessage(trgm, allowlist), /protected trgm_gin_index entry disappeared/u);
  assert.match(staleMessage(rename, allowlist), /^prisma-drift: allowlisted drift no longer present/u);
  assert.match(staleMessage("DROP INDEX \"unknown\";", allowlist), /^prisma-drift: allowlisted drift no longer present/u);
});
