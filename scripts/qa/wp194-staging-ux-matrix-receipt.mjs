import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const REPORT = path.join(ROOT, ".ai-team", "reports", "wp194-staging-ux-matrix.json");
const SURFACES = Object.freeze(["home", "login", "admin_billing", "error_recovery"]);
const VIEWPORTS = Object.freeze(["desktop", "mobile"]);

export function expectedCells() {
  return SURFACES.flatMap((surface) => VIEWPORTS.map((viewport) => `${surface}:${viewport}`));
}

export function scoreEligible(receipt) {
  const cells = receipt?.matrix?.cells ?? [];
  const unique = new Set(cells.map((cell) => `${cell.surface}:${cell.viewport}`));
  return receipt?.versionGate?.status === "PASS"
    && receipt?.browser?.automationControl === "AVAILABLE"
    && receipt?.browser?.authenticatedSession === "VALID"
    && receipt?.browser?.axeExecution === "PASS"
    && cells.length === 8
    && unique.size === 8
    && expectedCells().every((key) => unique.has(key))
    && cells.every((cell) => cell.pass === true
      && cell.seriousOrCritical === 0
      && cell.overflowPx <= 1
      && cell.focusPass === true
      && cell.semanticPass === true
      && cell.errorRecoveryPass === true)
    && Object.entries(receipt?.sideEffects ?? {})
      .filter(([key]) => !["versionReadOnlyOperations", "browserNavigationGets"].includes(key))
      .every(([, value]) => value === 0);
}

export function validateReceipt(receipt) {
  const errors = [];
  const statuses = [
    "WP194_COMPLETE_CANDIDATE",
    "CHROME_CONTROL_TIMEOUT",
    "CHROME_AUTOMATION_BLOCKED_BY_EXTENSION_UI",
    "VERSION_GATE_EXACT_NO_GO",
    "AUTH_UNVERIFIED",
    "AXE_TOOL_BLOCKED",
    "MATRIX_INCOMPLETE",
    "RECEIPT_SAFETY_EXACT_NO_GO",
  ];
  if (receipt?.schemaVersion !== "wp194-staging-ux-matrix/v1") errors.push("SCHEMA");
  if (!statuses.includes(receipt?.status)) errors.push("STATUS");
  if (receipt?.ownership?.preserveOnly !== true || receipt?.ownership?.unknown !== 0 || receipt?.ownership?.mixedHunks !== 0 || receipt?.ownership?.stagedIndexEmpty !== true) errors.push("OWNERSHIP");
  if (!Array.isArray(receipt?.matrix?.cells) || receipt.matrix.cells.length > 8 || receipt?.matrix?.completed !== receipt.matrix.cells.length || receipt?.matrix?.expected !== 8) errors.push("MATRIX_SCHEMA");
  if (receipt?.attempts?.versionInspect > 1 || receipt?.attempts?.versionMarker > 1 || receipt?.attempts?.chromeConnect > 1 || receipt?.attempts?.navigation > 1 || receipt?.attempts?.matrixCells > 8 || receipt?.attempts?.axeStart > 8) errors.push("ATTEMPT_BUDGET");
  if (Object.values(receipt?.safety ?? {}).some((value) => value !== false)) errors.push("PERSISTENCE");
  const eligible = scoreEligible(receipt);
  if (receipt?.status === "WP194_COMPLETE_CANDIDATE" && !eligible) errors.push("COMPLETE_GATE");
  if (!eligible && (receipt?.scoreImpact?.CAT06?.after !== 7 || receipt?.scoreImpact?.total?.after !== 73 || receipt?.scoreImpact?.applied !== false)) errors.push("FAIL_CLOSED_SCORE");
  if (receipt?.status === "CHROME_CONTROL_TIMEOUT" && !(receipt?.versionGate?.status === "PASS" && receipt?.browser?.automationControl === "UNRELIABLE_TIMEOUT" && receipt?.browser?.sessionFinalized === true && receipt?.matrix?.completed === 0 && receipt?.scoreImpact?.applied === false)) errors.push("TIMEOUT_GATE");
  const serialized = JSON.stringify(receipt);
  if (/(?:https?:\/\/|set-cookie|bearer\s+|begin private|"(?:cookie|token|password|secret|rawHtml|rawAxe|rawDom|rawUrl)"\s*:)/iu.test(serialized)) errors.push("LEAK_TEXT");
  return { ok: errors.length === 0, errors, scoreEligible: eligible };
}

async function verifyReport() {
  const receipt = JSON.parse(await fsp.readFile(REPORT, "utf8"));
  const checked = validateReceipt(receipt);
  process.stdout.write(`${JSON.stringify({ workPackage: "WP-194", strictReadback: checked.ok ? "PASS" : "FAIL", status: receipt.status, scoreEligible: checked.scoreEligible })}\n`);
  if (!checked.ok) process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === "--verify-report") await verifyReport();
  else throw new Error("WP194_LIVE_BROWSER_EXECUTION_IS_CONTROLLED_BY_CHROME_SKILL");
}

export const CONTRACT = Object.freeze({ report: REPORT, surfaces: SURFACES, viewports: VIEWPORTS, expectedCellCount: 8 });
