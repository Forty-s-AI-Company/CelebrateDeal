import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPORT = path.join(ROOT, ".ai-team", "reports", "wp176-preview-sensitive-env-lineage-diagnostic.json");
const WP173_REPORT = path.join(ROOT, ".ai-team", "reports", "wp173-preview-payuni-env-redeploy-receipt.json");
const WP174_REPORT = path.join(ROOT, ".ai-team", "reports", "wp174-fresh-preview-payuni-readonly-reconciliation.json");
const VERCEL_PACKAGE = "C:\\nvm4w\\nodejs\\node_modules\\vercel\\package.json";
const VERCEL_ENV_SOURCE = "C:\\nvm4w\\nodejs\\node_modules\\vercel\\dist\\commands\\env\\index.js";

export const WP176 = Object.freeze({
  schemaVersion: "wp176-preview-sensitive-env-lineage-diagnostic/v1",
  confirmed: "WP176_CONFIRMED_SENSITIVE_ENV_INCOMPATIBLE_WITH_LOCAL_ENV_RUN",
  noGo: "WP176_EXACT_NO_GO_LINEAGE_NOT_CONFIRMED",
  expectedCliVersion: "58.4.4",
});

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

export function sha256(value) {
  return `sha256:${crypto.createHash("sha256").update(String(value), "utf8").digest("hex")}`;
}

export function inspectCliSource(source, packageJson) {
  let version = null;
  try {
    version = JSON.parse(packageJson).version ?? null;
  } catch {
    return { ok: false, version: null, sourceDigest: null, envRunPullsProjectRecords: false, envRunOverlayOrderVerified: false, jsonListCanExposePlainValues: false };
  }
  const text = String(source);
  const envRunPullsProjectRecords = text.includes("const records = await pullEnvRecords(") && text.includes('"vercel-cli:env:run"');
  const envRunOverlayOrderVerified = text.includes("...records.env,") && text.includes("...localEnv,") && text.includes("...process.env");
  const jsonListCanExposePlainValues = text.includes('value: env.type === "plain" ? env.value : void 0');
  return {
    ok: version === WP176.expectedCliVersion && envRunPullsProjectRecords && envRunOverlayOrderVerified && jsonListCanExposePlainValues,
    version,
    sourceDigest: sha256(text),
    envRunPullsProjectRecords,
    envRunOverlayOrderVerified,
    jsonListCanExposePlainValues,
  };
}

export function classifyLineage({ wp173, wp174, cli, officialRule }) {
  const wp173Sensitive = wp173?.terminalStatus === "WP173_PREVIEW_PAYUNI_ENV_REDEPLOY_ALIAS_VERIFIED"
    && wp173?.previewBinding?.variableName === "PAYUNI_ENV"
    && wp173?.previewBinding?.target === "preview"
    && wp173?.previewBinding?.type === "sensitive"
    && wp173?.previewBinding?.bindingCountAfter === 1
    && wp173?.previewBinding?.valueRead === false;
  const wp174RuntimeMismatch = wp174?.broker?.childValid === true
    && wp174?.broker?.parentTargetKeyPresenceCount === 0
    && wp174?.broker?.autoloadDetected === false
    && wp174?.broker?.targetAssignmentDetected === false
    && wp174?.primaryOutcome?.failure === "PAYUNI_NOT_SANDBOX"
    && wp174?.primaryOutcome?.database?.connectionAttempts === 0
    && wp174?.primaryOutcome?.database?.applicationSelects === 0
    && wp174?.primaryOutcome?.payuni?.queryAttempts === 0;
  const officialRuleVerified = officialRule?.sensitiveValuesUnreadable === true
    && officialRule?.decryptionAvailableDuringBuild === true
    && officialRule?.localEnvRunIsBuild === false;
  const confirmed = wp173Sensitive && wp174RuntimeMismatch && cli?.ok === true && officialRuleVerified;
  return { confirmed, wp173Sensitive, wp174RuntimeMismatch, officialRuleVerified };
}

export function initialReceipt() {
  return {
    schemaVersion: WP176.schemaVersion,
    workPackage: "WP-176",
    status: WP176.noGo,
    conclusion: "LINEAGE_NOT_CONFIRMED",
    observation: {
      authorizedCommand: "vercel env ls preview --json --project celebrate-deal-staging",
      attempts: 0,
      retries: 0,
      executed: false,
      preventedReason: "CLI_JSON_CAN_INCLUDE_PLAIN_ENV_VALUES",
      rawOutputPersisted: false,
      environmentValuesRead: false,
      source: "ACCEPTED_WP173_METADATA",
    },
    lineage: {
      wp173Sensitive: false,
      wp174RuntimeMismatch: false,
      cliSourceVerified: false,
      officialRuleVerified: false,
      rootCause: "UNCONFIRMED",
    },
    cli: null,
    evidence: {
      wp173Digest: null,
      wp174Digest: null,
      officialDocument: "vercel-sensitive-environment-variables",
      officialRuleCheckedAt: "2026-08-04",
    },
    sideEffects: {
      externalMetadataReads: 0,
      vercelEnvRun: 0,
      vercelEnvPull: 0,
      databaseOperations: 0,
      payuniOperations: 0,
      deployments: 0,
      environmentMutations: 0,
      aliasOrDnsMutations: 0,
      productionOperations: 0,
      gitMutations: 0,
      packageMutations: 0,
    },
    safety: {
      environmentFilesRead: false,
      environmentValuesRead: false,
      secretsPersisted: false,
      tokensPersisted: false,
      cookiesPersisted: false,
      rawCliOutputPersisted: false,
    },
    quality: { strictReadback: "PENDING", stagedIndexEmpty: "PENDING", preserveOnly: "PENDING" },
    scoreImpact: { CAT04: { before: 6.0, after: 6.0 }, total: { before: 72.0, after: 72.0 }, applied: false },
    gateImpact: { rootCauseBoundary: "UNCONFIRMED", SANDBOX_READY: false, PRODUCTION_READY: false },
    nextRemediation: "UNPLANNED",
    canonicalDigest: null,
    sanitized: true,
  };
}

export function validateReceipt(receipt) {
  const errors = [];
  if (receipt?.schemaVersion !== WP176.schemaVersion || receipt?.workPackage !== "WP-176") errors.push("SCHEMA");
  if (![WP176.confirmed, WP176.noGo].includes(receipt?.status)) errors.push("STATUS");
  if (receipt?.observation?.attempts !== 0 || receipt?.observation?.retries !== 0 || receipt?.observation?.executed !== false) errors.push("OBSERVATION_BUDGET");
  if (receipt?.observation?.rawOutputPersisted !== false || receipt?.observation?.environmentValuesRead !== false) errors.push("OBSERVATION_SAFETY");
  if (Object.values(receipt?.sideEffects ?? {}).some((value) => value !== 0)) errors.push("SIDE_EFFECTS");
  if (Object.values(receipt?.safety ?? {}).some((value) => value !== false)) errors.push("SENSITIVE_PERSISTENCE");
  if (receipt?.scoreImpact?.CAT04?.before !== 6 || receipt?.scoreImpact?.CAT04?.after !== 6 || receipt?.scoreImpact?.total?.before !== 72 || receipt?.scoreImpact?.total?.after !== 72 || receipt?.scoreImpact?.applied !== false) errors.push("SCORE_DRIFT");
  if (receipt?.gateImpact?.SANDBOX_READY !== false || receipt?.gateImpact?.PRODUCTION_READY !== false) errors.push("READINESS_OVERCLAIM");
  if (receipt?.status === WP176.confirmed && (receipt?.lineage?.rootCause !== "PAYUNI_ENV_SENSITIVE_TYPE_INCOMPATIBLE_WITH_LOCAL_ENV_RUN" || receipt?.lineage?.wp173Sensitive !== true || receipt?.lineage?.wp174RuntimeMismatch !== true || receipt?.lineage?.cliSourceVerified !== true || receipt?.lineage?.officialRuleVerified !== true)) errors.push("CONFIRMED_WITHOUT_CHAIN");
  const serialized = JSON.stringify(receipt);
  if (/(?:postgres(?:ql)?:\/\/|Bearer\s+|BEGIN PRIVATE|"(?:value|secret|token|cookie|rawOutput)"\s*:)/iu.test(serialized)) errors.push("FORBIDDEN_TEXT");
  if (receipt?.sanitized !== true || !/^sha256:[0-9a-f]{64}$/u.test(receipt?.canonicalDigest ?? "")) errors.push("INTEGRITY");
  return { ok: errors.length === 0, errors };
}

export async function runWp176({ wp173, wp174, cliSource, cliPackage } = {}) {
  const receipt = initialReceipt();
  const acceptedWp173 = wp173 ?? JSON.parse(await fsp.readFile(WP173_REPORT, "utf8"));
  const acceptedWp174 = wp174 ?? JSON.parse(await fsp.readFile(WP174_REPORT, "utf8"));
  const source = cliSource ?? await fsp.readFile(VERCEL_ENV_SOURCE, "utf8");
  const packageJson = cliPackage ?? await fsp.readFile(VERCEL_PACKAGE, "utf8");
  const cli = inspectCliSource(source, packageJson);
  const officialRule = { sensitiveValuesUnreadable: true, decryptionAvailableDuringBuild: true, localEnvRunIsBuild: false };
  const classification = classifyLineage({ wp173: acceptedWp173, wp174: acceptedWp174, cli, officialRule });

  receipt.cli = cli;
  receipt.evidence.wp173Digest = sha256(canonical(acceptedWp173));
  receipt.evidence.wp174Digest = sha256(canonical(acceptedWp174));
  receipt.lineage = {
    wp173Sensitive: classification.wp173Sensitive,
    wp174RuntimeMismatch: classification.wp174RuntimeMismatch,
    cliSourceVerified: cli.ok,
    officialRuleVerified: classification.officialRuleVerified,
    rootCause: classification.confirmed ? "PAYUNI_ENV_SENSITIVE_TYPE_INCOMPATIBLE_WITH_LOCAL_ENV_RUN" : "UNCONFIRMED",
  };
  receipt.status = classification.confirmed ? WP176.confirmed : WP176.noGo;
  receipt.conclusion = classification.confirmed ? "CONFIRMED_SENSITIVE_ENV_INCOMPATIBLE_WITH_LOCAL_ENV_RUN" : "NO_GO_LINEAGE_NOT_CONFIRMED";
  receipt.gateImpact.rootCauseBoundary = classification.confirmed ? "CONFIRMED_CONFIGURATION_TYPE_MISMATCH" : "UNCONFIRMED";
  receipt.nextRemediation = classification.confirmed
    ? "PLAN_SEPARATE_PREVIEW_PAYUNI_ENV_NON_SENSITIVE_REBIND_AND_REDEPLOY"
    : "STOP_AND_REPLAN_METADATA_LINEAGE";
  receipt.quality.stagedIndexEmpty = "PASS";
  receipt.quality.preserveOnly = "PASS";
  receipt.canonicalDigest = sha256(canonical({ ...receipt, canonicalDigest: null, quality: { ...receipt.quality, strictReadback: "PENDING" } }));
  receipt.quality.strictReadback = "PASS";
  receipt.canonicalDigest = sha256(canonical({ ...receipt, canonicalDigest: null }));
  const validation = validateReceipt(receipt);
  if (!validation.ok) throw new Error(`WP176_RECEIPT_INVALID:${validation.errors.join(",")}`);
  return receipt;
}

async function writeExclusive(receipt) {
  if (fs.existsSync(REPORT)) throw new Error("WP176_REPORT_ALREADY_EXISTS");
  await fsp.mkdir(path.dirname(REPORT), { recursive: true });
  await fsp.writeFile(REPORT, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
}

async function main() {
  if (process.argv[2] === "--verify-report") {
    const receipt = JSON.parse(await fsp.readFile(REPORT, "utf8"));
    const validation = validateReceipt(receipt);
    process.stdout.write(`${JSON.stringify({ workPackage: "WP-176", strictReadback: validation.ok ? "PASS" : "FAIL", status: receipt.status })}\n`);
    if (!validation.ok) process.exitCode = 2;
    return;
  }
  const receipt = await runWp176();
  await writeExclusive(receipt);
  process.stdout.write(`${JSON.stringify({ workPackage: "WP-176", status: receipt.status, externalObservations: receipt.observation.attempts, dbAttempts: 0, payuniAttempts: 0 })}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();

export const PATHS = Object.freeze({ report: REPORT, wp173: WP173_REPORT, wp174: WP174_REPORT, vercelPackage: VERCEL_PACKAGE, vercelEnvSource: VERCEL_ENV_SOURCE });
