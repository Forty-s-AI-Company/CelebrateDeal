import path from "node:path";
import { fileURLToPath } from "node:url";

import { main } from "./g7-email-disposable-qa.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const workspaceRoot = path.resolve(path.dirname(scriptPath), "..");

await main({
  workPackage: "G7-23",
  schemaVersion: "celebratedeal-g7-live-reminder-reconciliation-disposable/v1",
  receiptPath: path.join(workspaceRoot, ".ai-team", "reports", "g7-23-live-reminder-reconciliation-disposable-20260809.json"),
  suite: "reconciliation",
  expectedSuitePath: "src/lib/live-reminder-reconciliation.db.test.ts",
  requiredTests: [
    "keeps jobs tenant-scoped and reuses the deterministic duplicate queue identity",
    "supersedes an older pending job when the live schedule configuration changes",
    "reactivates the unsent A reminder after an A to B to A configuration reversal",
    "rejects a stale A worker after the live transaction commits configuration B",
    "rejects a stale title A worker after the live transaction commits title B",
    "processes only VERIFIED submissions in stable createdAt/id batches and persists the cursor",
    "cancels queued or failed reminder deliveries for a disabled configuration",
    "recovers a stale lease and permits only one concurrent claim",
  ],
});
