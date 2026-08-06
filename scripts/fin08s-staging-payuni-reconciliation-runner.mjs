import path from "node:path";
import { fileURLToPath } from "node:url";
import { diagnose, verify, TARGET_KEYS, SYSTEM_KEYS, buildSterileEnv, countTargetKeys, validateDiagnosticReceipt, initialReceipt } from "./fin08s-sterile-isolation-diagnostic.mjs";

const ENTRY = fileURLToPath(import.meta.url);

if (process.argv[1] && path.resolve(process.argv[1]) === ENTRY) {
  if (process.argv[2] === "--diagnose-isolation") await diagnose();
  else if (process.argv[2] === "--verify-receipt") await verify(process.argv[3]);
  else throw new Error("FIN08S_DIAGNOSTIC_REQUIRED");
}

export { TARGET_KEYS, SYSTEM_KEYS, buildSterileEnv, countTargetKeys, validateDiagnosticReceipt, initialReceipt, diagnose, verify };
