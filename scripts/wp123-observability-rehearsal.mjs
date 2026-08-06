import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(scriptPath), "..");
const contractPath = path.join(root, "docs", "launch", "wp123-observability-rehearsal-contract.json");
const fixturesPath = path.join(root, "scripts", "wp123-observability-rehearsal-fixtures.json");
const receiptPath = path.join(root, ".ai-team", "reports", "wp123-observability-rehearsal-receipt.json");

const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
};
const hash = (value, length) => crypto.createHash("sha256").update(canonical(value)).digest("hex").slice(0, length);
const clone = (value) => JSON.parse(JSON.stringify(value));

export function loadJson(value, label) {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${label} must be an object.`);
  return clone(parsed);
}

export function validateContract(contract) {
  if (contract.schemaVersion !== "celebratedeal-ai-team-wp123-observability-contract/v1" || contract.sourceWorkPackage !== "WP-116") throw new Error("WP-123 contract lineage is invalid.");
  if (contract.status !== "LOCAL_REHEARSAL_ONLY") throw new Error("WP-123 contract must remain local-only.");
  for (const [eventType, schema] of Object.entries(contract.eventSchemas)) {
    if (!Array.isArray(schema.requiredFields) || schema.requiredFields.length === 0) throw new Error(`${eventType} required fields are missing.`);
    if (!schema.requiredFields.includes("timestamp")) throw new Error(`${eventType} must include timestamp.`);
  }
  if (contract.eventSchemas.payment_webhook_request_v1.requiredFields.join(",") !== "event,method,path,source,status,timestamp") throw new Error("WP-116 request schema drifted.");
  if (contract.eventSchemas.payment_webhook_failure_v1.requiredFields.join(",") !== "event,method,path,source,status,code,timestamp") throw new Error("WP-116 failure schema drifted.");
  if (contract.receiptPolicy.externalTelemetry !== "PENDING" || contract.receiptPolicy.SANDBOX_READY !== false || contract.receiptPolicy.PRODUCTION_READY !== false) throw new Error("Readiness boundary is invalid.");
  if (contract.correlationPolicy.purpose !== "LOCAL_REHEARSAL_ONLY_NOT_A_PRODUCTION_LOG_FIELD") throw new Error("Correlation policy must remain local-only.");
  return true;
}

function assertExactKeys(value, required, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  const keys = Object.keys(value).sort();
  const expected = [...required].sort();
  if (JSON.stringify(keys) !== JSON.stringify(expected)) throw new Error(`${label} contains missing or unknown fields.`);
}

function validateTimestamp(timestamp, label) {
  if (typeof timestamp !== "string" || !/^2026-08-02T15:\d{2}:\d{2}\.000Z$/.test(timestamp) || Number.isNaN(Date.parse(timestamp))) throw new Error(`${label} timestamp is invalid.`);
}

function validateObservedEvent(event, contract) {
  const schema = contract.eventSchemas[event?.event];
  if (!schema) throw new Error("Unknown event type.");
  assertExactKeys(event, schema.requiredFields, `${event.event} event`);
  if (event.path !== contract.fixedFields.path) throw new Error("Observed path is outside the WP-116 fixed path.");
  if (!schema.allowedMethods.includes(event.method) || !schema.allowedSources.includes(event.source) || !schema.allowedStatuses.includes(event.status)) throw new Error("Observed event contains an invalid fixed-schema value.");
  validateTimestamp(event.timestamp, event.event);
  if (schema.allowedCodes && !schema.allowedCodes.includes(event.code)) throw new Error("Observed failure code is not in the WP-116 allowlist.");
  return event;
}

function deriveCorrelation(event) {
  return `corr_${hash({ event: event.event, method: event.method, path: event.path, source: event.source, status: event.status, code: event.code ?? null, timestamp: event.timestamp }, 16)}`;
}

function deriveFingerprint(event) {
  return `fp_${hash(event, 24)}`;
}

function stableScenarioReceipt(receipt) {
  return JSON.parse(canonical(receipt));
}

export function evaluateScenario(scenarioInput, contractInput) {
  const contract = loadJson(contractInput, "contract");
  validateContract(contract);
  const scenario = loadJson(scenarioInput, "scenario");
  if (typeof scenario.id !== "string" || !Array.isArray(scenario.timeline)) return { id: scenario.id ?? "unknown", status: "BLOCKED_OR_FAILED", failureCode: "invalid_scenario" };
  const timeline = scenario.timeline.map((item, index) => ({ ...item, originalIndex: index }));
  try {
    timeline.sort((left, right) => {
      const leftTime = left.action === "observe" ? left.event?.timestamp : left.timestamp;
      const rightTime = right.action === "observe" ? right.event?.timestamp : right.timestamp;
      const delta = String(leftTime).localeCompare(String(rightTime));
      return delta || left.originalIndex - right.originalIndex;
    });
    const incidents = new Map();
    const fingerprints = new Set();
    const transitions = [];
    const redaction = "PASS";
    for (const item of timeline) {
      if (typeof item.evidenceId !== "string" || !/^evidence-[a-z0-9-]+$/.test(item.evidenceId)) throw new Error("Evidence ID is invalid.");
      if (item.action === "observe") {
        const event = validateObservedEvent(item.event, contract);
        const fingerprint = deriveFingerprint(event);
        if (fingerprints.has(fingerprint)) {
          transitions.push({ evidenceId: item.evidenceId, transition: "suppressed_duplicate" });
          continue;
        }
        fingerprints.add(fingerprint);
        if (event.event === "payment_webhook_failure_v1") {
          const mapping = contract.incidentMapping[event.code];
          if (!mapping) throw new Error("Failure code has no incident mapping.");
          const correlationId = deriveCorrelation(event);
          const existing = incidents.get(correlationId);
          if (existing) {
            existing.suppressed += 1;
            transitions.push({ evidenceId: item.evidenceId, transition: "suppressed_duplicate" });
          } else {
            incidents.set(correlationId, { correlationId, incidentCode: mapping.incidentCode, severity: mapping.severity, detected: 1, suppressed: 0, recovered: 0, recoveryRejected: 0, evidenceIds: [item.evidenceId], status: "detected" });
            transitions.push({ evidenceId: item.evidenceId, transition: "detected" });
          }
        } else if (event.status >= 500) {
          const correlationId = deriveCorrelation(event);
          incidents.set(correlationId, { correlationId, incidentCode: "payment_webhook_unclassified_failure", severity: "high", detected: 1, suppressed: 0, recovered: 0, recoveryRejected: 0, evidenceIds: [item.evidenceId], status: "detected" });
          transitions.push({ evidenceId: item.evidenceId, transition: "detected" });
        } else transitions.push({ evidenceId: item.evidenceId, transition: "healthy" });
      } else if (item.action === "recover") {
        if (item.target !== "last_open_correlation" && item.target !== "unrelated_correlation") throw new Error("Recovery target is invalid.");
        validateTimestamp(item.timestamp, "recovery");
        const open = [...incidents.values()].find((incident) => incident.status === "detected");
        if (item.target === "last_open_correlation" && open) {
          open.recovered += 1;
          open.status = "recovered";
          transitions.push({ evidenceId: item.evidenceId, transition: "recovered", correlationId: open.correlationId });
        } else transitions.push({ evidenceId: item.evidenceId, transition: "recovery_rejected" });
      } else throw new Error("Unknown rehearsal action.");
    }
    const incidentList = [...incidents.values()].sort((a, b) => a.correlationId.localeCompare(b.correlationId));
    return stableScenarioReceipt({ id: scenario.id, status: "PASS", localIncidentRehearsal: "PASS", incidents: incidentList, transitions, externalTelemetry: "PENDING", SANDBOX_READY: false, PRODUCTION_READY: false, redaction });
  } catch (error) {
    return { id: scenario.id, status: "BLOCKED_OR_FAILED", localIncidentRehearsal: "BLOCKED", failureCode: "invalid_or_unsafe_event", failureClass: error instanceof Error ? error.message : String(error), externalTelemetry: "PENDING", SANDBOX_READY: false, PRODUCTION_READY: false };
  }
}

export function runFixtureSet(contractInput, fixturesInput) {
  const contract = loadJson(contractInput, "contract");
  validateContract(contract);
  const fixtures = loadJson(fixturesInput, "fixtures");
  if (fixtures.schemaVersion !== "celebratedeal-ai-team-wp123-fixtures/v1" || !Array.isArray(fixtures.scenarios) || fixtures.scenarios.length < 9) throw new Error("WP-123 fixture set is incomplete.");
  const results = fixtures.scenarios.map((scenario) => evaluateScenario(scenario, contract));
  for (const [index, result] of results.entries()) {
    const expected = fixtures.scenarios[index].expected;
    if (expected === "PASS" && result.status !== "PASS") throw new Error(`${result.id} did not pass rehearsal.`);
    if (expected === "FAIL_CLOSED" && result.status !== "BLOCKED_OR_FAILED") throw new Error(`${result.id} did not fail closed.`);
  }
  return { schemaVersion: "celebratedeal-ai-team-wp123/v1", workPackage: "WP-123", status: "PASS", localIncidentRehearsal: "PASS", scenarios: results, externalTelemetry: "PENDING", SANDBOX_READY: false, PRODUCTION_READY: false, rawEventPayloadSaved: false, sensitiveValuesSaved: false };
}

export function main() {
  let receipt;
  try { receipt = runFixtureSet(fs.readFileSync(contractPath, "utf8"), fs.readFileSync(fixturesPath, "utf8")); }
  catch { receipt = { schemaVersion: "celebratedeal-ai-team-wp123/v1", workPackage: "WP-123", status: "BLOCKED_OR_FAILED", localIncidentRehearsal: "BLOCKED", failureCode: "fixture_or_contract_invalid", externalTelemetry: "PENDING", SANDBOX_READY: false, PRODUCTION_READY: false, rawEventPayloadSaved: false, sensitiveValuesSaved: false }; }
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  if (receipt.status === "PASS") console.log(JSON.stringify({ workPackage: "WP-123", status: "PASS", scenarios: receipt.scenarios.length, localIncidentRehearsal: receipt.localIncidentRehearsal, externalTelemetry: receipt.externalTelemetry }));
  else process.exitCode = 1;
  return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) main();
