import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  STAGING_MIGRATION_RECEIPT_SCHEMA,
  validateStagingMigrationReceipt,
} from './staging-migration-evidence.mjs';

// This CLI only reads an already-sanitized receipt. It never runs migrations,
// opens a database connection, calls a provider, or writes an evidence file.
const WORKSPACE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAFE_RECEIPT_DIRECTORIES = Object.freeze([
  'docs/ai-team/evidence',
  '.ai-team/reports',
]);
const SAFE_RECEIPT_FILENAME = /(?:receipt|evidence)\.json$/iu;
const SENSITIVE_PATH_SEGMENT = /(?:^|[._-])(?:env|secret|token|cookie|password|credential|private|connection)(?:$|[._-])/iu;
const STAGING_RESULTS = Object.freeze(['PASS', 'FAILED', 'BLOCKED']);
const STAGING_ENVIRONMENTS = Object.freeze(['staging', 'isolated-restore-drill', 'unknown']);
const STAGING_DATABASE_IDENTITIES = Object.freeze(['staging-database', 'isolated-restore-target', 'unknown']);
const VALIDATION_FAILURE_REASONS = new Set([
  'receipt_path_required',
  'invalid_path',
  'read_failed',
  'invalid_receipt',
  'invalid_result',
]);

function pathApiFor(value) {
  return /^[A-Za-z]:[\\/]/u.test(value) || value.includes('\\') ? path.win32 : path;
}

function normalizeRelativePath(inputPath, workspaceRoot = WORKSPACE_ROOT) {
  if (typeof inputPath !== 'string' || inputPath.length === 0 || inputPath.includes('\0')) return null;
  const pathApi = pathApiFor(workspaceRoot);
  if (pathApi.isAbsolute(inputPath) || inputPath.startsWith('\\') || inputPath.startsWith('/')) return null;

  const resolvedRoot = pathApi.resolve(workspaceRoot);
  const resolvedPath = pathApi.resolve(resolvedRoot, inputPath);
  const relativePath = pathApi.relative(resolvedRoot, resolvedPath);
  const normalized = relativePath.split(pathApi.sep).join('/');
  if (!normalized || normalized === '..' || normalized.startsWith('../') || pathApi.isAbsolute(relativePath)) return null;

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
    const pathApi = pathApiFor(canonicalRoot);
    const relative = pathApi.relative(canonicalRoot, canonicalPath);
    const normalized = relative.split(pathApi.sep).join('/');
    const allowedDirectory = SAFE_RECEIPT_DIRECTORIES.some((directory) => normalized.startsWith(`${directory}/`));
    const safeFilename = SAFE_RECEIPT_FILENAME.test(path.posix.basename(normalized));
    const sensitiveSegment = normalized.split('/').some((segment) => segment.startsWith('.env') || SENSITIVE_PATH_SEGMENT.test(segment));
    if (!normalized || normalized === '..' || normalized.startsWith('../') || pathApi.isAbsolute(relative) || !allowedDirectory || !safeFilename || sensitiveSegment) return null;
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

async function validateStagingMigrationReceiptFile(inputPath, fsAdapter = fs, workspaceRoot = WORKSPACE_ROOT) {
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
  if (!receipt || !validateStagingMigrationReceipt(receipt)) return { ok: false, reason: 'invalid_receipt' };
  return {
    ok: true,
    schemaVersion: receipt.schemaVersion,
    result: receipt.result,
    environmentClass: receipt.environmentClass,
    databaseIdentityClass: receipt.databaseIdentityClass,
    sanitized: receipt.safety.sanitized,
  };
}

function formatValidationResult(validation) {
  if (
    validation?.ok === true
    && validation.schemaVersion === STAGING_MIGRATION_RECEIPT_SCHEMA
    && STAGING_RESULTS.includes(validation.result)
    && STAGING_ENVIRONMENTS.includes(validation.environmentClass)
    && STAGING_DATABASE_IDENTITIES.includes(validation.databaseIdentityClass)
    && validation.sanitized === true
  ) {
    return `staging_migration_validation=PASS; result=${validation.result}; environment=${validation.environmentClass}; database=${validation.databaseIdentityClass}; sanitized=true`;
  }
  const reason = VALIDATION_FAILURE_REASONS.has(validation?.reason) ? validation.reason : 'invalid_result';
  return `staging_migration_validation=FAIL; reason=${reason}`;
}

async function runCli(argv = process.argv.slice(2), fsAdapter = fs, workspaceRoot = WORKSPACE_ROOT) {
  if (argv.length !== 1) return { ok: false, reason: 'receipt_path_required' };
  return validateStagingMigrationReceiptFile(argv[0], fsAdapter, workspaceRoot);
}

const invokedScript = process.argv[1] ? path.resolve(process.argv[1]) : null;
const currentScript = fileURLToPath(import.meta.url);

if (invokedScript === currentScript) {
  void runCli().then((validation) => {
    console.log(formatValidationResult(validation));
    process.exitCode = validation.ok ? 0 : 1;
  }).catch(() => {
    console.log('staging_migration_validation=FAIL; reason=invalid_result');
    process.exitCode = 1;
  });
}

export {
  formatValidationResult,
  normalizeRelativePath,
  resolveSafeReceiptPath,
  runCli,
  validateStagingMigrationReceiptFile,
};
