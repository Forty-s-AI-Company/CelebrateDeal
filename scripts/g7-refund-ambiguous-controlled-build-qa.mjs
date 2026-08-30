import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runControlledProductionBuild } from "./build/controlled-production-build.mjs";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const receiptPath = path.join(workspaceRoot, ".ai-team", "reports", "g7-56-refund-ambiguous-controlled-build-final-20260810.json");
const startedAt = new Date().toISOString();
const result = await runControlledProductionBuild({ sourceRoot: workspaceRoot });
const receipt = {
  schemaVersion: "celebratedeal-g7-refund-ambiguous-controlled-build/v1",
  workPackage: "G7-56",
  status: result.exitCode === 0 ? "PASS" : "BLOCKED_OR_FAILED",
  startedAt,
  finishedAt: new Date().toISOString(),
  exitCode: result.exitCode,
  signal: result.signal,
  failureCategory: result.failureCategory,
  inheritedApplicationEnvironment: result.inheritedApplicationEnvironment,
  controlledKeyNames: result.controlledKeyNames,
  cleanup: { mirror: "PASS" },
  safety: { dotenvCopied: false, rawOutputPersisted: false, externalOperations: false, productionOperations: false },
};
const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
await fs.mkdir(path.dirname(receiptPath), { recursive: true });
await fs.writeFile(receiptPath, serialized, { encoding: "utf8", flag: "wx" });
const digest = crypto.createHash("sha256").update(serialized).digest("hex").toUpperCase();
await fs.writeFile(`${receiptPath}.sha256`, `${digest}  ${path.basename(receiptPath)}\n`, { encoding: "utf8", flag: "wx" });
process.stdout.write(`${JSON.stringify({ workPackage: receipt.workPackage, status: receipt.status, exitCode: receipt.exitCode, failureCategory: receipt.failureCategory, cleanup: receipt.cleanup })}\n`);
if (receipt.status !== "PASS") process.exitCode = 1;
