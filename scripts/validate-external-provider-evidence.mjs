import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EXTERNAL_PROVIDERS,
  EXTERNAL_PROVIDER_RESULTS,
  parseAndValidateExternalProviderReceipt,
} from './external-provider-evidence.mjs';

// The CLI is intentionally read-only. It validates a receipt before an owner
// attaches it to a non-Production evidence packet and never writes a result.
const WORKSPACE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAFE_RECEIPT_DIRECTORIES = Object.freeze([
  'docs/ai-team/evidence',
  '.ai-team/reports',
]);
const SAFE_RECEIPT_FILENAME = /(?:receipt|evidence)\.json$/i;
const SENSITIVE_PATH_SEGMENT = /(?:^|[._-])(?:env|secret|token|cookie|password|credential|private|connection)(?:$|[._-])/i;
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

async function validateExternalProviderReceiptFile(inputPath, fsAdapter = fs, workspaceRoot = WORKSPACE_ROOT) {
  let receiptPath;
  try {
    receiptPath = resolveSafeReceiptPath(inputPath, workspaceRoot);
  } catch {
    return { ok: false, reason: 'invalid_path' };
  }

  let source;
  try {
    source = await fsAdapter.readFile(receiptPath, 'utf8');
  } catch {
    return { ok: false, reason: 'read_failed' };
  }

  const parsed = parseAndValidateExternalProviderReceipt(source);
  if (!parsed.ok) return { ok: false, reason: 'invalid_receipt' };
  return {
    ok: true,
    provider: parsed.value.provider,
    result: parsed.value.result,
    sanitized: parsed.value.sanitized,
  };
}

function formatValidationResult(validation) {
  if (
    validation?.ok === true
    && EXTERNAL_PROVIDERS.includes(validation.provider)
    && EXTERNAL_PROVIDER_RESULTS.includes(validation.result)
    && validation.sanitized === true
  ) {
    return `receipt_validation=PASS; provider=${validation.provider}; result=${validation.result}; sanitized=true`;
  }
  const reason = VALIDATION_FAILURE_REASONS.has(validation?.reason) ? validation.reason : 'invalid_result';
  return `receipt_validation=FAIL; reason=${reason}`;
}

async function runCli(argv = process.argv.slice(2), fsAdapter = fs, workspaceRoot = WORKSPACE_ROOT) {
  if (argv.length !== 1) return { ok: false, reason: 'receipt_path_required' };
  return validateExternalProviderReceiptFile(argv[0], fsAdapter, workspaceRoot);
}

const invokedScript = process.argv[1] ? path.resolve(process.argv[1]) : null;
const currentScript = fileURLToPath(import.meta.url);

if (invokedScript === currentScript) {
  void runCli().then((validation) => {
    console.log(formatValidationResult(validation));
    process.exitCode = validation.ok ? 0 : 1;
  }).catch(() => {
    console.log('receipt_validation=FAIL; reason=invalid_result');
    process.exitCode = 1;
  });
}

export {
  formatValidationResult,
  normalizeRelativePath,
  resolveSafeReceiptPath,
  runCli,
  validateExternalProviderReceiptFile,
};
