import crypto from "node:crypto";

export const CLASSIFICATIONS = Object.freeze({
  SYNTHETIC_ENV_CONTRACT: "SYNTHETIC_ENV_CONTRACT",
  MIRROR_COMPLETENESS: "MIRROR_COMPLETENESS",
  NODE_MODULES_JUNCTION: "NODE_MODULES_JUNCTION",
  NEXT_WEBPACK_BOUNDARY: "NEXT_WEBPACK_BOUNDARY",
  MANIFESTED_WORKSPACE_COMPILE: "MANIFESTED_WORKSPACE_COMPILE",
  UNKNOWN_FAIL_CLOSED: "UNKNOWN_FAIL_CLOSED",
});

const OWNED_CLASSIFICATIONS = new Set([
  CLASSIFICATIONS.SYNTHETIC_ENV_CONTRACT,
  CLASSIFICATIONS.MIRROR_COMPLETENESS,
  CLASSIFICATIONS.NODE_MODULES_JUNCTION,
]);

function digest(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function sanitizeOutput(value) {
  return String(value ?? "")
    .replaceAll(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replaceAll(/https?:\/\/[^\s)]+/gi, "<url>")
    .replaceAll(/[A-Za-z]:\\[^\r\n\s)]+/g, "<path>")
    .replaceAll(/(?:^|\s)\/[^\r\n\s)]+/g, " <path>")
    .replaceAll(/\b[A-Z][A-Z0-9_]{2,}=([^\s]+)/g, () => "=<value>")
    .replaceAll(/(['"`])(?:\\.|(?!\1).)*\1/g, "<value>");
}

function hasOutput(output, pattern) {
  return pattern.test(sanitizeOutput(output));
}

export function classifyFailure(input) {
  const buildExitCode = Number.isInteger(input.buildExitCode) ? input.buildExitCode : null;
  const buildOutput = String(input.buildOutput ?? "");
  const typecheckExitCode = Number.isInteger(input.typecheckExitCode) ? input.typecheckExitCode : null;
  const requiredInputsMissing = Array.isArray(input.requiredInputsMissing) && input.requiredInputsMissing.length > 0;
  const moduleResolutionFailed = input.moduleResolutionFailed === true;
  const junctionStable = input.junctionStable !== false;
  const unknownEnvironmentNames = Array.isArray(input.unknownEnvironmentNames) && input.unknownEnvironmentNames.length > 0;

  if (unknownEnvironmentNames) {
    return { classification: CLASSIFICATIONS.SYNTHETIC_ENV_CONTRACT, owner: "WP-125", confidence: "deterministic" };
  }
  if (requiredInputsMissing) {
    return { classification: CLASSIFICATIONS.MIRROR_COMPLETENESS, owner: "WP-125", confidence: "deterministic" };
  }
  if (moduleResolutionFailed || !junctionStable) {
    return { classification: CLASSIFICATIONS.NODE_MODULES_JUNCTION, owner: "WP-125", confidence: "deterministic" };
  }
  if (typecheckExitCode !== null && typecheckExitCode !== 0) {
    return { classification: CLASSIFICATIONS.MANIFESTED_WORKSPACE_COMPILE, owner: "PRESERVE_ONLY application or manifested source", confidence: "deterministic" };
  }
  if (buildExitCode !== 0 && hasOutput(buildOutput, /dotenv|environment|missing required/i)) {
    return { classification: CLASSIFICATIONS.SYNTHETIC_ENV_CONTRACT, owner: "WP-125", confidence: "bounded" };
  }
  if (buildExitCode !== 0 && hasOutput(buildOutput, /module not found|cannot find module|could not resolve/i)) {
    return { classification: CLASSIFICATIONS.NODE_MODULES_JUNCTION, owner: "WP-125", confidence: "bounded" };
  }
  if (buildExitCode !== 0 && typecheckExitCode === 0 && hasOutput(buildOutput, /failed to compile|type error|build worker|webpack/i)) {
    return { classification: CLASSIFICATIONS.NEXT_WEBPACK_BOUNDARY, owner: "PRESERVE_ONLY Next.js/Webpack or application boundary", confidence: "bounded" };
  }
  return { classification: CLASSIFICATIONS.UNKNOWN_FAIL_CLOSED, owner: "UNPROVEN", confidence: "unknown" };
}

export function classifyReceipt(input) {
  const result = classifyFailure(input);
  const raw = String(input.buildOutput ?? "");
  return {
    ...result,
    outcome: result.classification === CLASSIFICATIONS.UNKNOWN_FAIL_CLOSED
      ? "UNKNOWN_FAIL_CLOSED"
      : result.classification === CLASSIFICATIONS.NEXT_WEBPACK_BOUNDARY || result.classification === CLASSIFICATIONS.MANIFESTED_WORKSPACE_COMPILE
        ? "DIAGNOSED_OUTSIDE_OWNERSHIP"
        : "OWNED_CLASSIFICATION",
    rawOutputPersisted: false,
    sanitizedOutputDigest: digest(sanitizeOutput(raw)),
    outputLineCount: raw.split(/\r?\n/).filter(Boolean).length,
    remediationAllowed: OWNED_CLASSIFICATIONS.has(result.classification),
  };
}
