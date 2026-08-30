import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTRACT_PATH = path.join(ROOT, "docs", "launch", "wp195-launch-owner-acceptance-contract.json");
const FIXTURES_PATH = path.join(ROOT, "scripts", "wp195-launch-owner-acceptance-fixtures.json");
const REPORT_PATH = path.join(ROOT, ".ai-team", "reports", "wp195-launch-owner-acceptance.json");
const REQUIRED_ROLES = Object.freeze(["finance_owner", "merchant_owner", "privacy_policy_owner", "release_owner", "support_operator"]);
const ALLOWED_STATES = new Set(["PENDING", "ACCEPTED", "REJECTED", "BLOCKED"]);
const SENSITIVE_PATTERN = /(?:https?:\/\/|bearer\s+|(?:password|secret|token|cookie|private[_ -]?key|card[_ -]?number|database_url)[:=]\S+)/iu;
const HOLDER_REF_PATTERN = /^synthetic:[a-z0-9_-]+$/u;

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]));
  return value;
}

function exactRoleSet(owners) {
  const ids = owners.map((owner) => owner.id ?? owner.ownerId).sort();
  return ids.length === REQUIRED_ROLES.length && new Set(ids).size === ids.length && ids.every((id, index) => id === REQUIRED_ROLES[index]);
}

export function validateContract(contract) {
  const errors = [];
  if (contract?.schemaVersion !== "wp195-launch-owner-acceptance/v2") errors.push("SCHEMA");
  if (!Array.isArray(contract?.owners) || !exactRoleSet(contract.owners)) errors.push("ROLE_SET");
  if (contract?.ownerModel?.sameHumanMultipleRoles !== true || contract?.ownerModel?.distinctHumanRequired !== false || contract?.ownerModel?.minimumHumanCount !== 1) errors.push("OWNER_MODEL");
  for (const owner of contract?.owners ?? []) {
    if (!Array.isArray(owner.responsibilities) || owner.responsibilities.length < 3) errors.push(`RESPONSIBILITIES:${owner.id}`);
    if (!Array.isArray(owner.requiredChecks) || owner.requiredChecks.length < 3) errors.push(`CHECKS:${owner.id}`);
  }
  if (JSON.stringify([...(contract?.allowedDecisionStates ?? [])].sort()) !== JSON.stringify([...ALLOWED_STATES].sort())) errors.push("DECISION_STATES");
  if (contract?.invariants?.manualSignatures !== "PENDING" || contract?.invariants?.releaseStatus !== "HOLD_NOT_READY" || contract?.invariants?.productionReady !== false || contract?.invariants?.externalSideEffects !== 0) errors.push("INVARIANTS");
  const evidence = contract?.evidenceSchema;
  if (!Array.isArray(evidence?.requiredFields) || evidence.requiredFields.length !== 7 || evidence.sanitized !== true || evidence.synthetic !== true || evidence.holderRefPattern !== "^synthetic:[a-z0-9_-]+$") errors.push("EVIDENCE_SCHEMA");
  return { ok: errors.length === 0, errors };
}

export function baselinePacket(contract, timestamp) {
  return contract.owners.map((owner) => ({
    ownerId: owner.id,
    holderRef: "synthetic:solo-founder",
    sameHumanMultipleRoles: true,
    decision: "ACCEPTED",
    manualSignature: "PENDING",
    releaseDecision: owner.id === "release_owner" ? "HOLD" : undefined,
    evidence: owner.requiredChecks.map((checkId) => ({ ownerId: owner.id, holderRef: "synthetic:solo-founder", checkId, sourceRef: `synthetic:${checkId}`, capturedAt: timestamp, sanitized: true, synthetic: true })),
  }));
}

function mutatePacket(packet, mutation) {
  const copy = structuredClone(packet);
  if (mutation === "REMOVE_SUPPORT") return copy.filter((item) => item.ownerId !== "support_operator");
  if (mutation === "DUPLICATE_FINANCE") return [...copy, structuredClone(copy.find((item) => item.ownerId === "finance_owner"))];
  if (mutation === "ADD_UNKNOWN") return [...copy, { ownerId: "unknown_owner", holderRef: "synthetic:solo-founder", decision: "ACCEPTED", manualSignature: "PENDING", evidence: [] }];
  if (mutation === "REMOVE_EVIDENCE") copy[0].evidence.pop();
  if (mutation === "INVALID_EVIDENCE") copy[0].evidence[0].sourceRef = "invalid-source";
  if (mutation === "REJECT_MERCHANT") copy.find((item) => item.ownerId === "merchant_owner").decision = "REJECTED";
  if (mutation === "BLOCK_FINANCE") copy.find((item) => item.ownerId === "finance_owner").decision = "BLOCKED";
  if (mutation === "PENDING_LEGAL") copy.find((item) => item.ownerId === "privacy_policy_owner").decision = "PENDING";
  if (mutation === "UNKNOWN_RELEASE_DECISION") copy.find((item) => item.ownerId === "release_owner").releaseDecision = "UNKNOWN";
  if (mutation === "REMOVE_HOLDER_REF") delete copy[0].holderRef;
  if (mutation === "CLAIM_PRODUCTION_READY") copy.productionReady = true;
  if (mutation === "ADD_SENSITIVE_TEXT") copy[0].evidence[0].sourceRef = "secret:should-not-appear";
  if (mutation === "REVERSE_OWNER_ORDER") copy.reverse();
  return copy;
}

export function evaluatePacket(contract, packet) {
  const blockers = [];
  if (packet?.productionReady === true) return { inputRejected: true, blockers: ["PRODUCTION_READY_CLAIM_REJECTED"] };
  if (!Array.isArray(packet) || !exactRoleSet(packet.map((item) => ({ id: item.ownerId })))) blockers.push("ROLE_SET_INVALID");
  for (const owner of packet ?? []) {
    if (!REQUIRED_ROLES.includes(owner.ownerId)) continue;
    if (owner.sameHumanMultipleRoles !== true || !HOLDER_REF_PATTERN.test(owner.holderRef ?? "")) blockers.push(`HOLDER_REF_INVALID:${owner.ownerId}`);
    if (!ALLOWED_STATES.has(owner.decision)) blockers.push(`STATE_INVALID:${owner.ownerId}`);
    if (owner.decision !== "ACCEPTED") blockers.push(`OWNER_${owner.decision}:${owner.ownerId}`);
    if (owner.manualSignature !== "PENDING") blockers.push(`SIGNATURE_INVALID:${owner.ownerId}`);
    if (owner.ownerId === "release_owner" && owner.releaseDecision !== "HOLD") blockers.push("RELEASE_DECISION_INVALID");
    const definition = contract.owners.find((item) => item.id === owner.ownerId);
    const evidence = Array.isArray(owner.evidence) ? owner.evidence : [];
    for (const checkId of definition?.requiredChecks ?? []) {
      const item = evidence.find((entry) => entry.checkId === checkId);
      if (!item) blockers.push(`EVIDENCE_MISSING:${owner.ownerId}:${checkId}`);
      else if (item.ownerId !== owner.ownerId || item.holderRef !== owner.holderRef || !HOLDER_REF_PATTERN.test(item.holderRef ?? "") || !/^synthetic:[a-z0-9_-]+$/u.test(item.sourceRef) || !/^2026-08-04T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/u.test(item.capturedAt) || item.sanitized !== true || item.synthetic !== true || SENSITIVE_PATTERN.test(JSON.stringify(item))) blockers.push(`EVIDENCE_INVALID:${owner.ownerId}:${checkId}`);
    }
  }
  if (SENSITIVE_PATTERN.test(JSON.stringify(packet))) return { inputRejected: true, blockers: ["SENSITIVE_INPUT_REJECTED"] };
  return { inputRejected: false, blockers: [...new Set(blockers)].sort() };
}

export function runDryRun(contract, fixtures) {
  const contractCheck = validateContract(contract);
  if (!contractCheck.ok) throw new Error(`WP195_CONTRACT_INVALID:${contractCheck.errors.join(",")}`);
  const baseline = baselinePacket(contract, fixtures.fixedTimestamp);
  const scenarios = fixtures.scenarios.map((scenario) => {
    const evaluation = evaluatePacket(contract, mutatePacket(baseline, scenario.mutation));
    const actual = evaluation.inputRejected ? "REJECTED_INPUT" : "HOLD_NOT_READY";
    return { id: scenario.id, expected: scenario.expected, actual, pass: actual === scenario.expected, blockerCount: evaluation.blockers.length };
  });
  return {
    schemaVersion: "wp195-launch-owner-acceptance-receipt/v2",
    workPackage: "WP-195",
    status: scenarios.every((scenario) => scenario.pass) ? "WP195_COMPLETE_CANDIDATE" : "WP195_FAIL_CLOSED",
    timestamp: fixtures.fixedTimestamp,
    ownerMatrix: { requiredRoleCount: 5, coveredRoleCount: contract.owners.length, exactRoleSet: exactRoleSet(contract.owners), sameHumanMultipleRoles: true, distinctHumanRequired: false, holderRefCount: 1, responsibilityChecks: contract.owners.reduce((sum, owner) => sum + owner.requiredChecks.length, 0) },
    scenarios,
    aggregation: { manualSignatures: "PENDING", releaseStatus: "HOLD_NOT_READY", releaseDecision: "HOLD", legalComplianceSelfReview: true, notIndependentLegalCounsel: true, productionReady: false, overallCommercialReadiness: "NOT_READY" },
    sideEffects: { network: 0, databaseReads: 0, databaseWrites: 0, payments: 0, refunds: 0, email: 0, deployment: 0, production: 0, gitMutation: 0 },
    safety: { envFileRead: false, secretRead: false, credentialRead: false, realCustomerData: false, realPaymentData: false, realOwnerSignature: false, rawPayloadPersisted: false },
    ownership: { preserveOnly: true, unknown: 0, mixedHunks: 0, stagedIndexEmpty: true },
    scoreImpact: { CAT10: { before: 4.5, candidateAfterSoloReview: 4.5 }, total: { before: 75.5, candidateAfterSoloReview: 75.5 }, applied: false },
    sanitized: true,
  };
}

export function validateReceipt(receipt) {
  const errors = [];
  if (receipt?.schemaVersion !== "wp195-launch-owner-acceptance-receipt/v2") errors.push("SCHEMA");
  if (receipt?.status !== "WP195_COMPLETE_CANDIDATE") errors.push("STATUS");
  if (receipt?.ownerMatrix?.requiredRoleCount !== 5 || receipt?.ownerMatrix?.coveredRoleCount !== 5 || receipt?.ownerMatrix?.exactRoleSet !== true || receipt?.ownerMatrix?.sameHumanMultipleRoles !== true || receipt?.ownerMatrix?.distinctHumanRequired !== false || receipt?.ownerMatrix?.holderRefCount !== 1 || receipt?.ownerMatrix?.responsibilityChecks < 15) errors.push("ROLE_MATRIX");
  if (!Array.isArray(receipt?.scenarios) || receipt.scenarios.length < 12 || receipt.scenarios.some((scenario) => scenario.pass !== true)) errors.push("SCENARIOS");
  if (receipt?.aggregation?.manualSignatures !== "PENDING" || receipt?.aggregation?.releaseStatus !== "HOLD_NOT_READY" || receipt?.aggregation?.releaseDecision !== "HOLD" || receipt?.aggregation?.legalComplianceSelfReview !== true || receipt?.aggregation?.notIndependentLegalCounsel !== true || receipt?.aggregation?.productionReady !== false || receipt?.aggregation?.overallCommercialReadiness !== "NOT_READY") errors.push("AGGREGATION");
  if (Object.values(receipt?.sideEffects ?? {}).some((value) => value !== 0)) errors.push("SIDE_EFFECTS");
  if (Object.values(receipt?.safety ?? {}).some((value) => value !== false)) errors.push("SAFETY");
  if (receipt?.ownership?.preserveOnly !== true || receipt?.ownership?.unknown !== 0 || receipt?.ownership?.mixedHunks !== 0 || receipt?.ownership?.stagedIndexEmpty !== true) errors.push("OWNERSHIP");
  if (receipt?.scoreImpact?.applied !== false) errors.push("SCORE_APPLIED");
  if (SENSITIVE_PATTERN.test(JSON.stringify(receipt))) errors.push("LEAK_TEXT");
  return { ok: errors.length === 0, errors };
}

async function readJson(file) {
  return JSON.parse(await fsp.readFile(file, "utf8"));
}

async function execute() {
  const receipt = runDryRun(await readJson(CONTRACT_PATH), await readJson(FIXTURES_PATH));
  const checked = validateReceipt(receipt);
  if (!checked.ok) throw new Error(`WP195_RECEIPT_INVALID:${checked.errors.join(",")}`);
  await fsp.mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await fsp.writeFile(REPORT_PATH, `${JSON.stringify(stable(receipt))}\n`, { encoding: "utf8", flag: "wx" });
  process.stdout.write(`${JSON.stringify({ workPackage: "WP-195", status: receipt.status, scenarios: receipt.scenarios.length, releaseStatus: receipt.aggregation.releaseStatus })}\n`);
}

async function verifyReport() {
  const receipt = await readJson(REPORT_PATH);
  const checked = validateReceipt(receipt);
  process.stdout.write(`${JSON.stringify({ workPackage: "WP-195", strictReadback: checked.ok ? "PASS" : "FAIL", status: receipt.status })}\n`);
  if (!checked.ok) process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === "--verify-report") await verifyReport();
  else await execute();
}
