import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createLiveQaIsolation, checkLiveQaTypes, runLiveQaNode, writeLiveQaVitestConfig } from './live-qa-isolation.mjs';

const qa = createLiveQaIsolation();
const out = path.join(qa.root, 'docs/live-feature-handoffs/integration-20260912');
fs.mkdirSync(out, { recursive: true });
const receipt = { startedAt: new Date().toISOString(), boundary: 'fresh no-dotenv source mirror, separate Prisma client; unit/contracts use mocks; no DB tests in this command', phases: {}, suites: {}, sourceHashes: {} };
receipt.phases = checkLiveQaTypes(qa);
const lint = runLiveQaNode(qa, ['node_modules/eslint/bin/eslint.js', '--format=json']);
receipt.phases.lint = lint.exitCode;
receipt.lint = JSON.parse(lint.stdout || '[]').filter(file => file.errorCount || file.warningCount).map(file => ({ file: path.relative(qa.root, file.filePath), errors: file.errorCount, warnings: file.warningCount, messages: file.messages.map(m => ({ line: m.line, rule: m.ruleId, message: m.message })) }));
console.log(`lint: exit ${lint.exitCode}`);
const interactionCommand = JSON.parse(fs.readFileSync('package.json', 'utf8')).scripts['test:interactions'];
const interactions = [...interactionCommand.matchAll(/"([^"]+)"|([^\s]+)/g)].map(match => match[1] ?? match[2]).slice(2);
const targets = [
  'src/lib/interaction-card-polling.test.ts',
  ...['live-chat', 'live-chat-contract', 'live-chat-analytics', 'interaction-card', 'interaction-card-timeline', 'presenter-layout', 'presenter-headers', 'presenter-media', 'presenter-background', 'live-media-client', 'live-media-provider', 'live-playback-source', 'live-video-readiness', 'live-danmaku', 'scripted-roles', 'live-studio-draft', 'live-studio-draft-client'].map(name => `src/lib/${name}.test.ts`),
  ...['live-chat-panel', 'live-stepper-form', 'live-playback', 'interaction-script-form'].map(name => `src/components/${name}.test.tsx`),
  ...['live-chat/messages', 'live-chat/instructor', 'live-media', 'live-presenter', 'cron/live-media', 'live-admission', 'live-interactions'].map(name => `src/app/api/${name}/route.test.ts`),
  'src/app/(viewer)/live/[slug]/page.test.tsx',
];
const config = writeLiveQaVitestConfig(qa);
for (const [name, files] of [['interactions', interactions], ['live', targets]]) {
  const report = path.join(qa.temp, `${name}.json`);
  const result = runLiveQaNode(qa, ['node_modules/vitest/vitest.mjs', 'run', ...files, '--config', config, '--reporter=json', '--outputFile', report]);
  receipt.phases[name] = result.exitCode;
  const data = JSON.parse(fs.readFileSync(report, 'utf8'));
  const assertions = data.testResults.flatMap(suite => suite.assertionResults);
  receipt.suites[name] = { files: data.testResults.length, total: assertions.length, passed: assertions.filter(t => t.status === 'passed').length, skipped: assertions.filter(t => ['pending', 'skipped', 'todo'].includes(t.status)).length, failed: assertions.filter(t => t.status === 'failed').length, sources: files };
  if (data.testResults.length !== files.length || !assertions.length || assertions.some(t => t.status !== 'passed')) receipt.phases[name] = 1;
  for (const file of files) receipt.sourceHashes[file] = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if (result.exitCode !== 0) { process.stdout.write(result.stdout); process.stderr.write(result.stderr); }
  console.log(`${name}: exit ${result.exitCode}, ${assertions.length} tests`);
}
receipt.status = Object.keys(receipt.phases).length === 6 && Object.values(receipt.phases).every(code => code === 0) ? 'PASS' : 'FAIL';
receipt.finishedAt = new Date().toISOString();
const file = path.join(out, `checks-${Date.now()}.json`); fs.writeFileSync(file, JSON.stringify(receipt, null, 2));
console.log(JSON.stringify({ status: receipt.status, phases: receipt.phases, lint: receipt.lint, evidence: file }));
process.exitCode = receipt.status === 'PASS' ? 0 : 1;
