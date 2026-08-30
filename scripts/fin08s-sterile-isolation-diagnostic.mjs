import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPORT = path.join(ROOT, ".ai-team", "reports", "fin08s-staging-payuni-reconciliation.json");
const TARGET_KEYS = Object.freeze(["DATABASE_URL", "DIRECT_URL", "STAGING_DATABASE_URL", "PAYUNI_ENV", "PAYUNI_MERCHANT_ID", "PAYUNI_HASH_KEY", "PAYUNI_HASH_IV", "NEXT_PUBLIC_APP_URL", "NEXT_PUBLIC_SUPABASE_URL"]);
const SYSTEM_KEYS = Object.freeze(["SystemRoot", "WINDIR", "PATH", "PATHEXT", "ComSpec", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "ProgramData", "SystemDrive", "NVM_HOME"]);
const TERMINAL = new Set(["FIN08S_ISOLATION_PASS", "FIN08S_TERMINAL_NO_GO_CONTAMINATION", "FIN08S_TERMINAL_NO_GO_DIAGNOSTIC"]);

function digest(value) {
  return `sha256:${crypto.createHash("sha256").update(`FIN08S/v1/${String(value)}`, "utf8").digest("hex")}`;
}

export function countTargetKeys(env) {
  return TARGET_KEYS.filter((key) => Object.hasOwn(env ?? {}, key)).length;
}

export function buildSterileEnv(env = process.env) {
  const result = Object.create(null);
  const seen = new Set();
  for (const key of SYSTEM_KEYS) {
    const canonical = key.toUpperCase();
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    if (typeof env?.[key] === "string") result[key] = env[key];
  }
  return result;
}

export function validateDiagnosticReceipt(receipt) {
  const errors = [];
  if (receipt?.schemaVersion !== "fin08s-sterile-isolation-diagnostic/v1") errors.push("SCHEMA");
  if (!TERMINAL.has(receipt?.status)) errors.push("STATUS");
  if (!Number.isInteger(receipt?.parent?.targetKeyPresence) || !Number.isInteger(receipt?.child?.targetKeyPresence) || !Number.isInteger(receipt?.coordinator?.targetKeyPresence)) errors.push("COUNTS");
  if (receipt?.external?.vercelCalls !== 0 || receipt?.external?.httpCalls !== 0 || receipt?.external?.databaseConnections !== 0 || receipt?.external?.providerQueries !== 0 || receipt?.external?.databaseWrites !== 0) errors.push("EXTERNAL_SIDE_EFFECT");
  if (receipt?.safety?.dotenvRead !== false || receipt?.safety?.valuesRead !== false || receipt?.safety?.rawOutputPersisted !== false) errors.push("SAFETY");
  if (receipt?.status === "FIN08S_ISOLATION_PASS" && (receipt.parent.targetKeyPresence !== 0 || receipt.child.targetKeyPresence !== 0 || receipt.coordinator.targetKeyPresence !== 0)) errors.push("PASS_WITH_CONTAMINATION");
  if (/(?:postgres(?:ql)?:\/\/|https?:\/\/|Bearer\s+|BEGIN PRIVATE|"(?:rawOutput|credential|token|cookie)"\s*:)/iu.test(JSON.stringify(receipt))) errors.push("SENSITIVE_TEXT");
  return { ok: errors.length === 0, errors };
}

function initialReceipt() {
  return {
    schemaVersion: "fin08s-sterile-isolation-diagnostic/v1", workPackage: "FIN-08S", status: "FIN08S_TERMINAL_NO_GO_DIAGNOSTIC",
    parent: { targetKeyPresence: null }, child: { targetKeyPresence: null, exitCode: null }, coordinator: { targetKeyPresence: null, exitCode: null },
    external: { vercelCalls: 0, httpCalls: 0, databaseConnections: 0, providerQueries: 0, databaseWrites: 0 },
    safety: { dotenvRead: false, valuesRead: false, rawOutputPersisted: false }, sanitized: true, canonicalDigest: null,
  };
}

function childProbeCode() {
  return `const keys=${JSON.stringify(TARGET_KEYS)};const count=keys.filter((key)=>Object.hasOwn(process.env,key)).length;process.stdout.write(JSON.stringify({targetKeyPresence:count}));`;
}

async function writeReceipt(receipt) {
  const validation = validateDiagnosticReceipt(receipt);
  if (!validation.ok && receipt.status === "FIN08S_ISOLATION_PASS") receipt.status = "FIN08S_TERMINAL_NO_GO_DIAGNOSTIC";
  receipt.canonicalDigest = digest(JSON.stringify({ ...receipt, canonicalDigest: null }));
  await fsp.mkdir(path.dirname(REPORT), { recursive: true });
  await fsp.writeFile(REPORT, `${JSON.stringify(receipt)}\n`, { encoding: "utf8", flag: "wx" });
  process.stdout.write(`${JSON.stringify({ workPackage: "FIN-08S", status: receipt.status, parentTargetKeys: receipt.parent.targetKeyPresence, childTargetKeys: receipt.child.targetKeyPresence, coordinatorTargetKeys: receipt.coordinator.targetKeyPresence, strictReadback: validateDiagnosticReceipt(receipt).ok })}\n`);
  if (!validation.ok) process.exitCode = 2;
}

export async function diagnose() {
  const receipt = initialReceipt();
  receipt.parent.targetKeyPresence = countTargetKeys(process.env);
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), "celebratedeal-fin08s-"));
  try {
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", childProbeCode()], { cwd: temp, env: buildSterileEnv(), encoding: "utf8", windowsHide: true, shell: false, timeout: 15_000, maxBuffer: 4096 });
    receipt.child.exitCode = result.status ?? 1;
    try { receipt.child.targetKeyPresence = JSON.parse(String(result.stdout ?? "")).targetKeyPresence; } catch { receipt.child.targetKeyPresence = -1; }
    const coordinator = spawnSync(process.execPath, ["--input-type=module", "-e", childProbeCode()], { cwd: temp, env: buildSterileEnv(), encoding: "utf8", windowsHide: true, shell: false, timeout: 15_000, maxBuffer: 4096 });
    receipt.coordinator.exitCode = coordinator.status ?? 1;
    try { receipt.coordinator.targetKeyPresence = JSON.parse(String(coordinator.stdout ?? "")).targetKeyPresence; } catch { receipt.coordinator.targetKeyPresence = -1; }
    receipt.status = receipt.parent.targetKeyPresence === 0 && receipt.child.targetKeyPresence === 0 && receipt.coordinator.targetKeyPresence === 0 && receipt.child.exitCode === 0 && receipt.coordinator.exitCode === 0 ? "FIN08S_ISOLATION_PASS" : "FIN08S_TERMINAL_NO_GO_CONTAMINATION";
  } finally {
    await fsp.rm(temp, { recursive: true, force: true }).catch(() => {});
  }
  return writeReceipt(receipt);
}

export async function verify(receiptPath) {
  const receipt = JSON.parse(await fsp.readFile(path.resolve(receiptPath ?? REPORT), "utf8"));
  const result = validateDiagnosticReceipt(receipt);
  process.stdout.write(`${JSON.stringify({ workPackage: "FIN-08S", strictReadback: result.ok, errors: result.errors, status: receipt.status })}\n`);
  if (!result.ok) process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === "--diagnose-isolation") {
    if (fs.existsSync(REPORT)) throw new Error("FIN08S_RECEIPT_ALREADY_EXISTS");
    await diagnose();
  } else if (process.argv[2] === "--verify-receipt") await verify(process.argv[3]);
  else throw new Error("FIN08S_DIAGNOSTIC_REQUIRED");
}

export { TARGET_KEYS, SYSTEM_KEYS, initialReceipt };
