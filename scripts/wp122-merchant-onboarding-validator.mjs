import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(scriptPath), "..");
const contractPath = path.join(root, "docs", "launch", "wp122-merchant-onboarding-contract.json");
const fixturePath = path.join(root, "scripts", "wp122-merchant-onboarding-fixture.json");
const receiptPath = path.join(root, ".ai-team", "reports", "wp122-merchant-onboarding-receipt.json");

export const expectedStageIds = [
  "merchant_owner_identity",
  "security_mfa_minimum_privilege",
  "members_roles_active_owner",
  "branding_tracking",
  "product_live_forms_interactions",
  "plans_payuni_boundary",
  "support_refund_sop",
  "dns_terms_policy_release_acceptance",
];

const allowedEvidenceStatuses = new Set(["LOCAL_EVIDENCE", "EXTERNAL_REQUIRED", "MANUAL_REQUIRED", "OWNER_ACCEPTANCE_REQUIRED", "BLOCKED"]);
const pendingKeys = ["manualRehearsal", "legalApproval", "supportReadiness"];
const sensitivePattern = /bearer\s+|cookie\s*[:=]|password\s*[:=]|secret\s*[:=]|private[_ -]?key|access[_ -]?token|sk_live|-----begin|\b\d{13,19}\b|\b[^\s@]+@[^\s@]+\.[^\s@]+\b/i;
const placeholderPattern = /(?:\$\{|<[^>]+>|\b(?:TODO|TBD|FILL[_ -]?ME|REPLACE[_ -]?ME|CHANGEME)\b)/i;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} must be a non-empty string.`);
  if (placeholderPattern.test(value)) throw new Error(`${label} contains an unresolved placeholder.`);
}

function assertStringList(value, label) {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${label} must be a non-empty list.`);
  value.forEach((item, index) => assertNonEmptyString(item, `${label}[${index}]`));
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

export function loadJson(value, label) {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${label} must be a JSON object.`);
  return clone(parsed);
}

export function validateOnboardingContract(contractInput, fixtureInput) {
  const contract = loadJson(contractInput, "contract");
  const fixture = loadJson(fixtureInput, "fixture");
  if (contract.schemaVersion !== "celebratedeal-ai-team-wp122-onboarding-contract/v1" || contract.workPackage !== "WP-122") throw new Error("Contract schema or work package is invalid.");
  if (contract.contractStatus !== "DRAFT_LOCAL_ONLY" || contract.environment !== "local") throw new Error("Contract must remain local draft only.");
  if (!Array.isArray(contract.roles) || contract.roles.length !== 6) throw new Error("Contract must define exactly six roles.");
  const roleIds = contract.roles.map((role) => {
    assertNonEmptyString(role.id, "role.id");
    assertNonEmptyString(role.responsibility, `${role.id}.responsibility`);
    if (!Array.isArray(role.cannotReplace)) throw new Error(`${role.id}.cannotReplace must be a list.`);
    return role.id;
  });
  if (new Set(roleIds).size !== roleIds.length) throw new Error("Role IDs must be unique.");
  if (!Array.isArray(contract.stages) || contract.stages.length !== expectedStageIds.length) throw new Error("Contract must contain all eight onboarding stages.");
  const stageIds = contract.stages.map((stage, index) => {
    if (stage.id !== expectedStageIds[index]) throw new Error(`Stage ${index + 1} does not match the WP-110 stage contract.`);
    assertNonEmptyString(stage.purpose, `${stage.id}.purpose`);
    assertStringList(stage.ownerRoles, `${stage.id}.ownerRoles`);
    stage.ownerRoles.forEach((role) => { if (!roleIds.includes(role)) throw new Error(`${stage.id} references an unknown owner role.`); });
    assertStringList(stage.entryCriteria, `${stage.id}.entryCriteria`);
    assertStringList(stage.exitCriteria, `${stage.id}.exitCriteria`);
    if (!Array.isArray(stage.requiredEvidence) || stage.requiredEvidence.length === 0) throw new Error(`${stage.id}.requiredEvidence is empty.`);
    stage.requiredEvidence.forEach((evidence) => {
      assertNonEmptyString(evidence.type, `${stage.id}.evidence.type`);
      if (!allowedEvidenceStatuses.has(evidence.status)) throw new Error(`${stage.id} has an unknown evidence status.`);
    });
    if (stage.blocking !== true) throw new Error(`${stage.id} must be blocking until its exit criteria are accepted.`);
    assertNonEmptyString(stage.rollback, `${stage.id}.rollback`);
    assertNonEmptyString(stage.escalation, `${stage.id}.escalation`);
    assertNonEmptyString(stage.dataSensitivity, `${stage.id}.dataSensitivity`);
    assertNonEmptyString(stage.automationStatus, `${stage.id}.automationStatus`);
    assertNonEmptyString(stage.handoff, `${stage.id}.handoff`);
    return stage.id;
  });
  if (new Set(stageIds).size !== expectedStageIds.length) throw new Error("Stage IDs must be unique.");
  if (fixture.schemaVersion !== "celebratedeal-ai-team-wp122-fixture/v1" || fixture.environment !== "local") throw new Error("Fixture schema or environment is invalid.");
  if (fixture.localContract !== "PASS") throw new Error("LOCAL contract must pass before readiness can be evaluated.");
  for (const key of pendingKeys) if (fixture[key] !== "PENDING") throw new Error(`${key} must remain PENDING without a human receipt.`);
  if (fixture.overallReadiness !== "NOT_READY") throw new Error("Pending manual/legal/support evidence must keep overall readiness NOT_READY.");
  if (fixture.SANDBOX_READY !== false || fixture.PRODUCTION_READY !== false) throw new Error("Local onboarding evidence cannot set readiness labels true.");
  if (!fixture.stageEvidence || typeof fixture.stageEvidence !== "object") throw new Error("Fixture stageEvidence is required.");
  for (const stageId of expectedStageIds) {
    if (!allowedEvidenceStatuses.has(fixture.stageEvidence[stageId])) throw new Error(`Fixture status for ${stageId} is invalid.`);
  }
  const serialized = `${JSON.stringify(contract)}\n${JSON.stringify(fixture)}`;
  if (sensitivePattern.test(serialized)) throw new Error("Contract or fixture contains sensitive-value patterns.");
  if (placeholderPattern.test(serialized)) throw new Error("Contract or fixture contains unresolved placeholders.");
  const normalized = {
    workPackage: "WP-122",
    contractStatus: contract.contractStatus,
    stageIds: [...expectedStageIds],
    localContract: fixture.localContract,
    manualRehearsal: fixture.manualRehearsal,
    legalApproval: fixture.legalApproval,
    supportReadiness: fixture.supportReadiness,
    overallReadiness: fixture.overallReadiness,
    sandboxReady: fixture.SANDBOX_READY,
    productionReady: fixture.PRODUCTION_READY,
  };
  return {
    status: "PASS",
    localContract: "PASS",
    manualRehearsal: "PENDING",
    legalApproval: "PENDING",
    supportReadiness: "PENDING",
    overallReadiness: "NOT_READY",
    stageCount: expectedStageIds.length,
    roleCount: roleIds.length,
    normalized,
    normalizedHash: stable(normalized),
  };
}

export function buildReceipt(result) {
  return {
    schemaVersion: "celebratedeal-ai-team-wp122/v1",
    workPackage: "WP-122",
    status: result.status,
    localContract: result.localContract,
    manualRehearsal: result.manualRehearsal,
    legalApproval: result.legalApproval,
    supportReadiness: result.supportReadiness,
    overallReadiness: result.overallReadiness,
    stageCount: result.stageCount,
    roleCount: result.roleCount,
    normalizedHash: result.normalizedHash,
    scoreImpact: { CAT10: "PENDING_SOL_ACCEPTANCE", total: "PENDING_SOL_ACCEPTANCE", preAwarded: false },
    labels: { SANDBOX_READY: false, PRODUCTION_READY: false },
    externalSideEffects: false,
    productionOperation: false,
  };
}

export function main() {
  const receipt = (() => {
    try {
      const result = validateOnboardingContract(fs.readFileSync(contractPath, "utf8"), fs.readFileSync(fixturePath, "utf8"));
      return buildReceipt(result);
    } catch (error) {
      return {
        schemaVersion: "celebratedeal-ai-team-wp122/v1",
        workPackage: "WP-122",
        status: "BLOCKED_OR_FAILED",
        failure: error instanceof Error ? error.message : String(error),
        localContract: "BLOCKED",
        manualRehearsal: "PENDING",
        legalApproval: "PENDING",
        supportReadiness: "PENDING",
        overallReadiness: "NOT_READY",
        scoreImpact: { CAT10: "NO_CHANGE", total: "NO_CHANGE", preAwarded: false },
        labels: { SANDBOX_READY: false, PRODUCTION_READY: false },
        externalSideEffects: false,
        productionOperation: false,
      };
    }
  })();
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  if (receipt.status === "PASS") console.log(JSON.stringify({ workPackage: "WP-122", status: "PASS", localContract: receipt.localContract, overallReadiness: receipt.overallReadiness, stageCount: receipt.stageCount }));
  else process.exitCode = 1;
  return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) main();
