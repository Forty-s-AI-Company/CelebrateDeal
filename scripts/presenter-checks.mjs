import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { buildIsolatedEnvironment } from "./private-chat-disposable-qa.mjs";

// Explicit, synthetic subprocess environment; never load the project's .env files.
const root = process.cwd();
const temp = path.join(root, "tmp/presenter-checks");
for (const dir of [temp, ...["tmp", "home", "profile"].map(name => path.join(temp, name))]) fs.mkdirSync(dir, { recursive: true });
const env = buildIsolatedEnvironment(temp, { databaseUrl: "postgresql://postgres:postgres@127.0.0.1:54329/celebratedeal_test?schema=public" });
fs.writeFileSync(path.join(temp, "prisma.config.mjs"), `import {defineConfig} from ${JSON.stringify(path.join(root, "node_modules/prisma/config.js"))}; export default defineConfig({schema:${JSON.stringify(path.join(root, "prisma/schema.prisma"))},engine:'classic',datasource:{url:process.env.DATABASE_URL}});`);
const run = (args, cwd = root) => {
  const result = spawnSync(process.execPath, args, { cwd, env, encoding: "utf8", windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  process.stdout.write(result.stdout ?? ""); process.stderr.write(result.stderr ?? "");
  return result.status ?? 1;
};
const phases = {};
const schemaText = file => fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n").trim();
const generatedSchema = path.join(root, "node_modules/.prisma/client/schema.prisma");
const currentClient = fs.existsSync(generatedSchema) && schemaText(generatedSchema) === schemaText("prisma/schema.prisma");
// Windows may lock the engine DLL in an existing dev server; do not rewrite an already matching client.
phases.generate = currentClient ? 0 : run([path.join(root, "node_modules/prisma/build/index.js"), "generate", "--config", path.join(temp, "prisma.config.mjs")], temp);
console.log(currentClient ? "Prisma client schema matches canonical schema; no regeneration needed." : "Prisma generation attempted.");
phases.typecheck = run(["node_modules/typescript/bin/tsc", "--noEmit"]);
const files = ["next.config.ts", "src/lib/presenter-layout.ts", "src/lib/presenter-media.ts", "src/lib/live-media-client.ts", "src/lib/live-media-provider.ts", "src/lib/live-media-cleanup.ts", "src/lib/live-playback-source.ts", "src/lib/live-video-readiness.ts", "src/components/presenter-studio.tsx", "src/components/live-media-receiver.tsx", "src/components/live-playback.tsx", "src/app/api/live-media/route.ts", "src/app/api/live-presenter/route.ts", "src/app/api/cron/live-media/route.ts", "src/app/api/live-admission/route.ts", "src/app/(app)/lives/[id]/presenter/page.tsx", "src/app/(app)/lives/page.tsx", "scripts/presenter-checks.mjs", "scripts/presenter-browser-qa.mjs", "scripts/presenter-disposable-qa.mjs", "src/lib/presenter-layout.db.test.ts"];
const tests = ["src/lib/presenter-headers.test.ts", "src/lib/presenter-layout.test.ts", "src/lib/presenter-media.test.ts", "src/lib/live-media-client.test.ts", "src/lib/live-media-provider.test.ts", "src/lib/live-playback-source.test.ts", "src/lib/live-video-readiness.test.ts", "src/components/live-playback.test.tsx", "src/app/api/live-media/route.test.ts", "src/app/api/live-presenter/route.test.ts", "src/app/api/cron/live-media/route.test.ts", "src/app/api/live-admission/route.test.ts"];
phases.lint = run(["node_modules/eslint/bin/eslint.js", ...files, ...tests]);
phases.unit = run(["node_modules/vitest/vitest.mjs", "run", ...tests]);
fs.writeFileSync("docs/live-feature-handoffs/presenter-checks.json", JSON.stringify({ boundary: "isolated local generate/typecheck/lint/unit; no external services", generation: currentClient ? "verified existing client schema matches" : "generate command", phases }, null, 2));
process.exitCode = Object.values(phases).every(code => code === 0) ? 0 : 1;
