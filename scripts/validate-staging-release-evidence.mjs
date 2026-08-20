import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  STAGING_RELEASE_EVIDENCE_SCHEMA,
  validateStagingReleaseReceipt,
} from './staging-release-evidence.mjs';

// This CLI only reads an already-sanitized aggregate. It never runs a staging
// command, opens a database connection, calls a provider, or writes evidence.
const WORKSPACE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAFE_RECEIPT_DIRECTORIES = Object.freeze([
  'docs/ai-team/evidence',
  '.ai-team/reports',
]);
const SAFE_RECEIPT_FILENAME = /(?:receipt|evidence)\.json$/iu;
const SENSITIVE_PATH_SEGMENT = /(?:^|[._-])(?:env|secret|token|cookie|password|credential|private|connection)(?:$|[._-])/iu;
const VALIDATION_FAILURE_REASONS = new Set([
  'receipt_path_required',
  'invalid_path',
  'read_failed',
  'invalid_receipt',
  'invalid_result',
]);

function normalizeRelativePath(inputPath, workspaceRoot = WORKSPACE_ROOT) {
  if (typeof inputPath !== 'string' || inputPath.length === 0 || inputPath.includes('\0')) return null;
  if (path.isAbsolute(inputPath) || inputPath.startsWith('\\') || inputPath.startsWith('/')) return null;

  const resolvedRoot = path.resolve(workspaceRoot);
  const resolvedPath = path.resolve(resolvedRoot, inputPath);
  const relativePath = path.relative(resolvedRoot, resolvedPath);
  const normalized = relativePath.split(path.sep).join('/');
  if (!normalized || normalized === '..' || normalized.startsWith('../') || path.isAbsolute(relativePath)) return null;

  const directoryAllowed = SAFE_RECEIPT_DIRECTORIES.some((directory) => normalized.startsWith(`${directory}/`));
  if (!directoryAllowed || !SAFE_RECEIPT_FILENAME.test(path.posix.basename(normalized))) return null;
  if (normalized.split('/').some((segment) => segment.startsWith('.env') || SENSITIVE_PATH_SEGMENT.test(segment))) return null;
  return resolvedPath;
}

function resolveSafeReceiptPath(inputPath, workspaceRoot = WORKSPACE_ROOT) {
  const resolvedPath = normalizeRelativePath(inputPath, workspaceRoot);
  if (!resolvedPath) throw new Error('INVALID_RECEIPT_PATH');
  return resolvedPath;
}

async function resolveCanonicalReceiptPath(receiptPath, workspaceRoot, fsAdapter) {
  if (typeof fsAdapter.realpath !== 'function') return null;
  try {
    const canonicalRoot = await fsAdapter.realpath(workspaceRoot);
    const canonicalPath = await fsAdapter.realpath(receiptPath);
    const relative = path.relative(canonicalRoot, canonicalPath);
    const normalized = relative.split(path.sep).join('/');
    const allowedDirectory = SAFE_RECEIPT_DIRECTORIES.some((directory) => normalized.startsWith(`${directory}/`));
    const safeFilename = SAFE_RECEIPT_FILENAME.test(path.posix.basename(normalized));
    const sensitiveSegment = normalized.split('/').some((segment) => segment.startsWith('.env') || SENSITIVE_PATH_SEGMENT.test(segment));
    if (!normalized || normalized === '..' || normalized.startsWith('../') || path.isAbsolute(relative) || !allowedDirectory || !safeFilename || sensitiveSegment) return null;
    return canonicalPath;
  } catch {
    return null;
  }
}

function parseReceipt(source) {
  try {
    return JSON.parse(source);
  } catch {
    return null;
  }
}

async function validateStagingReleaseReceiptFile(inputPath, fsAdapter = fs, workspaceRoot = WORKSPACE_ROOT) {
  let receiptPath;
  try {
    receiptPath = resolveSafeReceiptPath(inputPath, workspaceRoot);
  } catch {
    return { ok: false, reason: 'invalid_path' };
  }

  const canonicalPath = await resolveCanonicalReceiptPath(receiptPath, workspaceRoot, fsAdapter);
  if (!canonicalPath) return { ok: false, reason: 'invalid_path' };

  let source;
  try {
    source = await fsAdapter.readFile(canonicalPath, 'utf8');
  } catch {
    return { ok: false, reason: 'read_failed' };
  }

  const receipt = parseReceipt(source);
  if (!receipt || !validateStagingReleaseReceipt(receipt)) return { ok: false, reason: 'invalid_receipt' };
  return {
    ok: true,
    schemaVersion: receipt.schemaVersion,
    result: receipt.result,
    sourceLineage: receipt.sourceCommit === 'unknown' ? 'unknown' : 'bound',
    sanitized: receipt.safety.sanitized,
  };
}

function formatValidationResult(validation) {
  if (
    validation?.ok === true
    && validation.schemaVersion === STAGING_RELEASE_EVIDENCE_SCHEMA
    && ['PASS', 'FAILED', 'BLOCKED'].includes(validation.result)
    && ['bound', 'unknown'].includes(validation.sourceLineage)
    && validation.sanitized === true
  ) {
    return `staging_release_validation=PASS; result=${validation.result}; source_lineage=${validation.sourceLineage}; sanitized=true`;
  }
  const reason = VALIDATION_FAILURE_REASONS.has(validation?.reason) ? validation.reason : 'invalid_result';
  return `staging_release_validation=FAIL; reason=${reason}`;
}

async function runCli(argv = process.argv.slice(2), fsAdapter = fs, workspaceRoot = WORKSPACE_ROOT) {
  if (argv.length !== 1) return { ok: false, reason: 'receipt_path_required' };
  return validateStagingReleaseReceiptFile(argv[0], fsAdapter, workspaceRoot);
}

const invokedScript = process.argv[1] ? path.resolve(process.argv[1]) : null;
const currentScript = fileURLToPath(import.meta.url);

if (invokedScript === currentScript) {
  void runCli().then((validation) => {
    console.log(formatValidationResult(validation));
    process.exitCode = validation.ok ? 0 : 1;
  }).catch(() => {
    console.log('staging_release_validation=FAIL; reason=invalid_result');
    process.exitCode = 1;
  });
}

export {
  formatValidationResult,
  normalizeRelativePath,
  resolveSafeReceiptPath,
  runCli,
  validateStagingReleaseReceiptFile,
};
