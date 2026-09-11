import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { buildIsolatedEnvironment } from "./private-chat-disposable-qa.mjs";
const temp = path.resolve("tmp/background-removal-checks");
for (const name of ["", "tmp", "home", "profile"]) fs.mkdirSync(path.join(temp, name), { recursive: true });
const env = buildIsolatedEnvironment(temp, { databaseUrl: "postgresql://postgres:postgres@127.0.0.1:54329/celebratedeal_test?schema=public" });
const files = ["src/lib/presenter-background.ts", "src/lib/presenter-background.test.ts", "src/lib/presenter-media.ts", "src/lib/presenter-media.test.ts", "src/components/presenter-studio.tsx", "scripts/background-removal-checks.mjs", "scripts/background-removal-browser-qa.mjs"];
const phases = {};
for (const [name, args] of Object.entries({ typecheck: ["node_modules/typescript/bin/tsc", "--noEmit"], lint: ["node_modules/eslint/bin/eslint.js", ...files], unit: ["node_modules/vitest/vitest.mjs", "run", "src/lib/presenter-background.test.ts", "src/lib/presenter-media.test.ts", "src/lib/presenter-layout.test.ts", "src/lib/live-media-client.test.ts", "--reporter=json", "--outputFile", path.join(temp, "unit.json")] })) {
  const result = spawnSync(process.execPath, args, { env, encoding: "utf8", windowsHide: true });
  process.stdout.write(result.stdout ?? ""); process.stderr.write(result.stderr ?? ""); phases[name] = result.status;
}
const report = JSON.parse(fs.readFileSync(path.join(temp, "unit.json"), "utf8"));
fs.writeFileSync("docs/live-feature-handoffs/background-removal-checks.json", JSON.stringify({ phases, tests: { total: report.numTotalTests, passed: report.numPassedTests, failed: report.numFailedTests }, boundary: "local TypeScript/ESLint/unit; worker and media mocked in unit tests" }, null, 2));
process.exitCode = Object.values(phases).every(value => value === 0) ? 0 : 1;
