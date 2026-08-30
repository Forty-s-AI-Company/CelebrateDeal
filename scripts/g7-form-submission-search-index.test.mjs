import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const migrationPath = path.resolve("prisma/migrations/20260810051000_g7_54_form_submission_search_indexes/migration.sql");
const searchPath = path.resolve("src/lib/form-submission-search.ts");

test("G7-54 contains search has a matching trigram index for every searched contact field", () => {
  const migration = fs.readFileSync(migrationPath, "utf8");
  const search = fs.readFileSync(searchPath, "utf8");
  assert.match(migration, /CREATE EXTENSION IF NOT EXISTS pg_trgm;/u);
  for (const field of ["name", "email", "phone"]) {
    assert.match(search, new RegExp(`\\{ ${field}: \\{ contains: criteria\\.query, mode: "insensitive" \\} \\}`, "u"));
    assert.match(migration, new RegExp(`CREATE INDEX "FormSubmission_${field}_trgm_idx"[\\s\\S]*USING GIN \\("${field}" gin_trgm_ops\\);`, "u"));
  }
  assert.doesNotMatch(migration, /DROP\s|DELETE\s|TRUNCATE\s|ALTER\s+COLUMN/iu);
});
