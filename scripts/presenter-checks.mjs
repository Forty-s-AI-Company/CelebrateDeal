import fs from "node:fs";
import { createLiveQaIsolation, checkLiveQaTypes, runLiveQaNode, writeLiveQaVitestConfig } from "./live-qa-isolation.mjs";

const qa = createLiveQaIsolation("presenter-checks");
const phases = checkLiveQaTypes(qa);
const run = args => { const r = runLiveQaNode(qa,args);process.stdout.write(r.stdout);process.stderr.write(r.stderr);return r.exitCode; };
const files = ["next.config.ts", "src/lib/presenter-layout.ts", "src/lib/presenter-media.ts", "src/lib/live-media-client.ts", "src/lib/live-media-provider.ts", "src/lib/live-media-cleanup.ts", "src/lib/live-playback-source.ts", "src/lib/live-video-readiness.ts", "src/components/presenter-studio.tsx", "src/components/live-media-receiver.tsx", "src/components/live-playback.tsx", "src/app/api/live-media/route.ts", "src/app/api/live-presenter/route.ts", "src/app/api/cron/live-media/route.ts", "src/app/api/live-admission/route.ts", "src/app/(app)/lives/[id]/presenter/page.tsx", "src/app/(app)/lives/page.tsx", "scripts/presenter-checks.mjs", "scripts/presenter-browser-qa.mjs", "scripts/presenter-disposable-qa.mjs", "src/lib/presenter-layout.db.test.ts"];
const tests = ["src/lib/presenter-headers.test.ts", "src/lib/presenter-layout.test.ts", "src/lib/presenter-media.test.ts", "src/lib/live-media-client.test.ts", "src/lib/live-media-provider.test.ts", "src/lib/live-playback-source.test.ts", "src/lib/live-video-readiness.test.ts", "src/components/live-playback.test.tsx", "src/app/api/live-media/route.test.ts", "src/app/api/live-presenter/route.test.ts", "src/app/api/cron/live-media/route.test.ts", "src/app/api/live-admission/route.test.ts"];
phases.lint = run(["node_modules/eslint/bin/eslint.js", ...files, ...tests]);
phases.unit = run(["node_modules/vitest/vitest.mjs", "run", ...tests, "--config", writeLiveQaVitestConfig(qa)]);
fs.writeFileSync("docs/live-feature-handoffs/presenter-checks.json", JSON.stringify({ boundary: "isolated local generate/typecheck/lint/unit; no external services", generation: "fresh independent Prisma client and no-dotenv Next source mirror", phases }, null, 2));
process.exitCode = Object.values(phases).every(code => code === 0) ? 0 : 1;
