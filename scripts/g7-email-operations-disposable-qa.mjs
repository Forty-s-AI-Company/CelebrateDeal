import path from "node:path";
import { fileURLToPath } from "node:url";
import { main } from "./g7-email-disposable-qa.mjs";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

await main({
  workPackage: "G7-55",
  schemaVersion: "celebratedeal-g7-email-operations-disposable/v1",
  receiptPath: path.join(workspaceRoot, ".ai-team", "reports", "g7-55-email-operations-disposable-20260810.json"),
  suite: "delivery",
  expectedSuitePath: "src/lib/email-delivery.db.test.ts",
  requiredTests: [
    "persists one idempotent delivery and tenant-scoped suppression state",
    "persists schedule and template revisions while atomically superseding older unsent reminders",
    "searches exact recipient hashes and filters within the authenticated tenant",
    "requeues only a tenant-owned failed delivery while preserving provider identity and audit history",
  ],
});
