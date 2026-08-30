import { spawnSync } from "node:child_process";

import { findNodeTapContractTests } from "./node-tap-contract-tests";

const testFiles = findNodeTapContractTests();

if (testFiles.length === 0) {
  throw new Error("No Node TAP contract tests were discovered.");
}

// Some contracts import TypeScript modules through the repository's `@/`
// alias. Use the existing TSX loader so Node TAP resolves them the same way
// as the application and Vitest.
const result = spawnSync(process.execPath, ["--import", "tsx", "--test", ...testFiles], {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit",
});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
