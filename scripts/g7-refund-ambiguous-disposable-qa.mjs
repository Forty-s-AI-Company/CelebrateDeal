import path from "node:path";
import { fileURLToPath } from "node:url";
import { main } from "./g7-email-disposable-qa.mjs";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

await main({
  workPackage: "G7-56",
  schemaVersion: "celebratedeal-g7-refund-ambiguous-disposable/v1",
  receiptPath: path.join(workspaceRoot, ".ai-team", "reports", "g7-56-refund-ambiguous-disposable-final-20260810.json"),
  suite: "refund",
  integrationPhase: "refundIntegration",
  expectedSuitePath: "src/lib/payuni-refund-ambiguous.db.test.ts",
  requiredTests: [
    "releases a paid transaction reservation only after a verified no-refund snapshot",
    "preserves processed partial totals while releasing only the unconfirmed reservation",
    "keeps an in-flight request reservation locked on a no-refund provider snapshot",
  ],
});
