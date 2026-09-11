import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildIsolatedEnvironment } from './private-chat-disposable-qa.mjs';

// Whitelisted source mirror: Next typegen must never load workspace .env files.
const root = process.cwd();
const temp = path.join(root, 'tmp/danmaku-checks');
fs.mkdirSync(temp, { recursive: true });
for (const dir of ['tmp', 'home', 'profile']) fs.mkdirSync(path.join(temp, dir), { recursive: true });
const env = buildIsolatedEnvironment(temp, { databaseUrl: 'postgresql://postgres:postgres@127.0.0.1:54329/celebratedeal_test?schema=public' });
const phases = {};
const run = (args, cwd = root) => {
  const result = spawnSync(process.execPath, args, { cwd, env, encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  process.stdout.write(result.stdout ?? ''); process.stderr.write(result.stderr ?? '');
  return result.status ?? 1;
};
// Generate a separate client: the interactive server may hold the root engine DLL.
const client = path.join(temp, 'generated-client');
fs.writeFileSync(path.join(temp, 'schema.prisma'), fs.readFileSync(path.join(root, 'prisma/schema.prisma'), 'utf8').replace('provider = "prisma-client-js"', `provider = "prisma-client-js"\n  output = ${JSON.stringify(client)}`));
fs.writeFileSync(path.join(temp, 'prisma.config.mjs'), `import {defineConfig} from ${JSON.stringify(path.join(root, 'node_modules/prisma/config.js'))}; export default defineConfig({schema:${JSON.stringify(path.join(temp, 'schema.prisma'))},engine:'classic',datasource:{url:process.env.DATABASE_URL}});`);
phases.generate = run([path.join(root, 'node_modules/prisma/build/index.js'), 'generate', '--config', path.join(temp, 'prisma.config.mjs')], temp);
const mirror = path.join(temp, 'source'); fs.mkdirSync(mirror, { recursive: true });
for (const directory of ['src', 'scripts', 'tests']) fs.cpSync(path.join(root, directory), path.join(mirror, directory), { recursive: true, filter: source => !path.basename(source).startsWith('.env') && !['node_modules', '.git'].includes(path.basename(source)) });
for (const name of ['package.json', 'tsconfig.json', 'next.config.ts', 'next-env.d.ts', 'sentry.server.config.ts', 'sentry.edge.config.ts']) if (fs.existsSync(path.join(root, name))) fs.copyFileSync(path.join(root, name), path.join(mirror, name));
fs.mkdirSync(path.join(mirror, 'public'), { recursive: true });
fs.copyFileSync(path.join(root, 'public/manifest.json'), path.join(mirror, 'public/manifest.json'));
const tsconfig = JSON.parse(fs.readFileSync(path.join(mirror, 'tsconfig.json'), 'utf8'));
tsconfig.compilerOptions.paths['@prisma/client'] = [path.join(client, 'index.d.ts')];
fs.writeFileSync(path.join(mirror, 'tsconfig.json'), JSON.stringify(tsconfig));
if (!fs.existsSync(path.join(mirror, 'node_modules'))) fs.symlinkSync(path.join(root, 'node_modules'), path.join(mirror, 'node_modules'), 'junction');
phases.typegen = run([path.join(root, 'node_modules/next/dist/bin/next'), 'typegen'], mirror);
phases.typecheck = run([path.join(root, 'node_modules/typescript/bin/tsc'), '--noEmit'], mirror);
const files = ['src/lib/live-danmaku.ts', 'src/lib/live-danmaku-contract.ts', 'src/lib/live-danmaku.test.ts', 'src/lib/live-danmaku.db.test.ts', 'src/app/api/live-danmaku/route.ts', 'src/components/live-danmaku.tsx', 'src/lib/interaction-card.ts', 'src/components/live-interaction-card.tsx', 'src/components/live-playback.tsx', 'src/components/live-interaction-studio.tsx', 'src/components/presenter-studio.tsx', 'scripts/danmaku-checks.mjs', 'scripts/danmaku-browser-qa.mjs', 'scripts/danmaku-disposable-qa.mjs'];
phases.lint = run(['node_modules/eslint/bin/eslint.js', ...files, '--max-warnings=0']);
phases.unit = run(['node_modules/vitest/vitest.mjs', 'run', 'src/lib/live-danmaku.test.ts', 'src/lib/interaction-card.test.ts', 'src/lib/interaction-card-timeline.test.ts', 'src/components/live-playback.test.tsx', 'src/app/api/live-interactions/route.test.ts', 'src/app/(viewer)/live/[slug]/page.test.tsx', '--reporter=json', '--outputFile', path.join(temp, 'unit.json')]);
const report = JSON.parse(fs.readFileSync(path.join(temp, 'unit.json'), 'utf8'));
const evidence = path.join(root, 'docs/live-feature-handoffs/danmaku-checks.json');
const previousAttempts = fs.existsSync(evidence) ? [JSON.parse(fs.readFileSync(evidence, 'utf8'))] : [];
fs.writeFileSync(evidence, JSON.stringify({ boundary: 'isolated synthetic environment; source-only Next typegen and TypeScript; no env files or external services', phases, tests: { total: report.numTotalTests, passed: report.numPassedTests, failed: report.numFailedTests }, previousAttempts }, null, 2));
process.exitCode = Object.values(phases).every(status => status === 0) ? 0 : 1;
