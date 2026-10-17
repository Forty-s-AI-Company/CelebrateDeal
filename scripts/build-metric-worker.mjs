import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, ".metric-worker");
fs.mkdirSync(output, { recursive: true });
// Fixed source allowlist: no dotenv loading, discovery or runtime compilation.
for (const name of ["live-metric-worker", "live-core-metrics-read-model", "live-viewing-evidence", "live-metric-contract", "live-metric-executor"]) {
  const source = fs.readFileSync(path.join(root, "src/lib", `${name}.ts`), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: `${name}.ts` });
  fs.writeFileSync(path.join(output, `${name}.js`), compiled.outputText);
}
fs.writeFileSync(path.join(output, "package.json"), JSON.stringify({ private: true, type: "commonjs" }));
console.log("Metric worker build complete");
