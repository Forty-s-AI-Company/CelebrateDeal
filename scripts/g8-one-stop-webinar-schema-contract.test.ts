import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "vitest";

const workspace = resolve(import.meta.dirname, "..");
const normalizeNewlines = (source: string) => source.replace(/\r\n/g, "\n");
const schema = normalizeNewlines(readFileSync(resolve(workspace, "prisma/schema.prisma"), "utf8"));
const migration = normalizeNewlines(readFileSync(
  resolve(
    workspace,
    "prisma/migrations/20260815090000_g8_01_one_stop_webinar_domain/migration.sql",
  ),
  "utf8",
));
const interactionRoleSemanticsMigration = normalizeNewlines(readFileSync(
  resolve(
    workspace,
    "prisma/migrations/20260815100000_g8_02_interaction_role_semantics/migration.sql",
  ),
  "utf8",
));

function requireText(source: string, text: string, label: string) {
  assert.ok(source.includes(text), `${label}: expected ${JSON.stringify(text)}`);
}

function requirePattern(source: string, pattern: RegExp, label: string) {
  assert.match(source, pattern, label);
}

test("keeps the one-stop webinar schema and migration additive and executable", () => {
  for (const model of ["LiveChatMessage", "LiveNotificationRule"]) {
    requireText(schema, `model ${model} {`, `model ${model}`);
    requireText(migration, `CREATE TABLE "${model}"`, `migration table ${model}`);
  }

  for (const text of [
    "startedAt                 DateTime?",
    "endedAt                   DateTime?",
    "replayAvailableUntil      DateTime?",
    "heroImageAssetId       String?",
    "backgroundImageAssetId String?",
    "promoVideoId           String?",
    "offerPriceCents Int?",
    "isVisible       Boolean @default(true)",
    "isSimulated Boolean  @default(true)",
    "post_live_followup",
  ]) {
    requireText(
      text === "post_live_followup" ? migration : schema,
      text,
      `one-stop webinar contract ${text}`,
    );
  }

  for (const [pattern, label] of [
    [
      /formSubmission\s+FormSubmission\?\s+@relation\(fields: \[liveId, formSubmissionId\], references: \[liveId, id\], onDelete: Restrict\)/,
      "LiveChatMessage same-live FormSubmission relation",
    ],
    [
      /role\s+InteractionRole\?\s+@relation\(fields: \[vendorId, roleId\], references: \[vendorId, id\], onDelete: Restrict\)/,
      "LiveChatMessage InteractionRole composite relation",
    ],
    [
      /@@unique\(\[liveId, id\]\)/,
      "FormSubmission composite unique",
    ],
  ] as const) {
    requirePattern(schema, pattern, label);
  }

  for (const text of [
    'CONSTRAINT "Live_lifecycle_check"',
    'CONSTRAINT "RegistrationForm_countdownMinutes_check"',
    'CONSTRAINT "LiveProduct_offerPriceCents_check"',
    'CONSTRAINT "LiveChatMessage_identity_check"',
    'CONSTRAINT "LiveNotificationRule_trigger_check"',
    'REFERENCES "ImageAsset"("vendorId", "id")',
    'REFERENCES "Video"("vendorId", "id")',
    'REFERENCES "Live"("vendorId", "id")',
    'REFERENCES "MessageTemplate"("vendorId", "id")',
    'CREATE INDEX "Live_vendorId_status_replayAvailableUntil_idx"',
    'CREATE INDEX "LiveProduct_vendorId_liveId_isVisible_sortOrder_idx"',
    'ALTER TABLE "InteractionEvent"\n  ADD COLUMN "isSimulated" BOOLEAN NOT NULL DEFAULT true;',
    'CREATE UNIQUE INDEX "FormSubmission_liveId_id_key"',
    'CREATE UNIQUE INDEX "InteractionRole_vendorId_id_key"',
    'FOREIGN KEY ("liveId", "formSubmissionId")\n    REFERENCES "FormSubmission"("liveId", "id")',
    'FOREIGN KEY ("vendorId", "roleId") REFERENCES "InteractionRole"("vendorId", "id")',
  ]) {
    requireText(migration, text, `migration contract ${text}`);
  }

  assert.doesNotMatch(
    migration,
    /^\s*(?:DROP\b|DELETE\s+FROM\b|TRUNCATE\b)/im,
    "G8.01 migration must stay additive",
  );
  assert.ok(!schema.includes("model RegistrationFormLive {"));
  assert.ok(!schema.includes("replayUrl"));
});

test("adds only the scheduled interaction role flag", () => {
  requirePattern(
    schema,
    /model InteractionRole \{[\s\S]*?isScheduled\s+Boolean\s+@default\(false\)[\s\S]*?\n\}/,
    "InteractionRole.isScheduled default",
  );

  const statements = interactionRoleSemanticsMigration
    .split(";")
    .map((statement) => statement.replace(/^\s*--[^\n]*(?:\n|$)/gm, "").trim())
    .filter(Boolean);
  assert.equal(statements.length, 1, "G8.02 must contain exactly one SQL statement");
  assert.match(
    statements[0] ?? "",
    /^ALTER TABLE "InteractionRole"\s+ADD COLUMN "isScheduled" BOOLEAN NOT NULL DEFAULT false$/,
  );
  assert.doesNotMatch(
    interactionRoleSemanticsMigration,
    /\b(?:UPDATE|DELETE|DROP|TRUNCATE|CREATE|CONSTRAINT|ENUM|BACKFILL)\b/i,
    "G8.02 must not backfill, constrain, enum-migrate, or alter unrelated objects",
  );
});
