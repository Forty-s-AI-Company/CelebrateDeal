import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const contractPath = resolve(root, "docs/launch/wp175-sales-to-support-operational-contract.json");
const fixturesPath = resolve(root, "scripts/wp175-sales-to-support-operational-rehearsal-fixtures.json");
const receiptPath = resolve(root, ".ai-team/reports/wp175-sales-to-support-operational-rehearsal-receipt.json");

const requiredPlanSignals = [
  "平台月費", "內含播放", "內含活動", "內含推廣者", "儲存額度",
  "平台金流月費", "交易服務費", "超額：", "月底月結後付",
];
const forbiddenReceiptKeys = /^(?:email|name|token|cookie|secret|password|card|payload|authorization|environmentValue)$/i;

export function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function loadInputs() {
  return {
    contract: JSON.parse(readFileSync(contractPath, "utf8")),
    fixtures: JSON.parse(readFileSync(fixturesPath, "utf8")),
  };
}

export function validateContract(contract) {
  const errors = [];
  if (contract.schemaVersion !== "wp175.v1") errors.push("schema_version");
  if (contract.scope !== "LOCAL_OPERATIONAL_REHEARSAL_ONLY") errors.push("scope");
  if (contract.roles?.length !== 8) errors.push("roles");
  if (contract.stages?.length !== 8) errors.push("stages");
  for (const stage of contract.stages ?? []) {
    for (const key of ["id", "owner", "requiredInputs", "allowedEvidence", "decisionState", "prohibitedActions", "nextOwner", "stopCondition", "sanitizedProjection"]) {
      if (!stage[key] || (Array.isArray(stage[key]) && stage[key].length === 0)) errors.push(`${stage.id ?? "unknown"}:${key}`);
    }
    if (!contract.roles.includes(stage.owner) || !contract.roles.includes(stage.nextOwner)) errors.push(`${stage.id}:owner`);
  }
  const boundary = contract.boundaries ?? {};
  for (const key of ["externalNetwork", "databaseReads", "databaseWrites", "paymentRequests", "refundRequests", "callbackRequests", "productionOperations"]) {
    if (boundary[key] !== false && boundary[key] !== 0) errors.push(`boundary:${key}`);
  }
  return errors;
}

export function verifyProtectedSources(contract) {
  const sourceDigests = {};
  for (const relativePath of contract.sourcePaths) {
    const content = readFileSync(resolve(root, relativePath), "utf8");
    sourceDigests[relativePath] = digest(content);
  }
  const plansSource = readFileSync(resolve(root, "src/app/(app)/billing/plans/page.tsx"), "utf8");
  const missingPlanSignals = requiredPlanSignals.filter((signal) => !plansSource.includes(signal));
  return { sourceDigests, missingPlanSignals };
}

export function evaluateScenario(scenario, contract) {
  if (scenario.fault) return { id: scenario.id, decision: "REJECTED", nextOwner: null };
  const stage = contract.stages.find((candidate) => candidate.id === scenario.stage);
  if (!stage || !["P0", "P1", "P2"].includes(scenario.severity)) {
    return { id: scenario.id, decision: "REJECTED", nextOwner: null };
  }
  return { id: scenario.id, decision: stage.decisionState, nextOwner: stage.nextOwner };
}

export function buildReceipt(contract, fixtures) {
  const contractErrors = validateContract(contract);
  const { sourceDigests, missingPlanSignals } = verifyProtectedSources(contract);
  const positive = fixtures.positive.map((item) => evaluateScenario(item, contract));
  const negative = fixtures.negative.map((item) => evaluateScenario(item, contract));
  const scenarioFailures = [
    ...positive.filter((result, index) => result.decision !== fixtures.positive[index].expected),
    ...negative.filter((result, index) => result.decision !== fixtures.negative[index].expected),
  ];
  const pass = contractErrors.length === 0 && missingPlanSignals.length === 0 && scenarioFailures.length === 0;
  const receipt = {
    schemaVersion: "wp175.receipt.v1",
    workPackage: "WP-175",
    result: pass ? "PASS" : "FAIL_CLOSED",
    localOperationalRehearsal: pass ? "PASS" : "FAIL_CLOSED",
    sourceDigests,
    contractDigest: digest(JSON.stringify(contract)),
    fixtureDigest: digest(JSON.stringify(fixtures)),
    stageCount: contract.stages.length,
    scenarioCounts: { positive: positive.length, negative: negative.length, failed: scenarioFailures.length },
    scenarioResults: [...positive, ...negative],
    validation: { contractErrors, missingPlanSignals },
    sideEffects: {
      externalNetwork: 0, databaseReads: 0, databaseWrites: 0, paymentRequests: 0,
      refundRequests: 0, callbackRequests: 0, outboundMessages: 0, deployments: 0, productionOperations: 0,
    },
    readiness: {
      manualMerchantRehearsal: "PENDING",
      supportOwnerAcceptance: "PENDING",
      legalPrivacyApproval: "PENDING",
      actualOffboardingDataRequest: "PENDING",
      overallCommercialReadiness: "NOT_READY",
      SANDBOX_READY: false,
      PRODUCTION_READY: false,
    },
  };
  receipt.receiptDigest = digest(JSON.stringify(receipt));
  return receipt;
}

export function validateReceipt(receipt) {
  const problems = [];
  const pending = [receipt];
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== "object") continue;
    for (const [key, nested] of Object.entries(value)) {
      if (forbiddenReceiptKeys.test(key)) problems.push("forbidden_sensitive_key");
      if (nested && typeof nested === "object") pending.push(nested);
    }
  }
  if (receipt.result !== "PASS") problems.push("result_not_pass");
  if (Object.values(receipt.sideEffects).some((value) => value !== 0)) problems.push("side_effect_detected");
  if (receipt.readiness.overallCommercialReadiness !== "NOT_READY") problems.push("commercial_readiness_overclaim");
  if (receipt.readiness.SANDBOX_READY || receipt.readiness.PRODUCTION_READY) problems.push("readiness_overclaim");
  return problems;
}

export function run() {
  const { contract, fixtures } = loadInputs();
  const receipt = buildReceipt(contract, fixtures);
  const receiptProblems = validateReceipt(receipt);
  if (receiptProblems.length) throw new Error(`WP-175 fail closed: ${receiptProblems.join(",")}`);
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: "utf8" });
  return receipt;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const receipt = run();
  console.log(`WP175_RESULT=${receipt.result}`);
  console.log(`WP175_SCENARIOS=${receipt.scenarioCounts.positive + receipt.scenarioCounts.negative}`);
  console.log(`WP175_RECEIPT_DIGEST=${receipt.receiptDigest}`);
}
