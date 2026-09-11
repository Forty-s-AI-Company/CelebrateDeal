import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { buildIsolatedEnvironment } from './private-chat-disposable-qa.mjs';

/** 每次建立獨立 client 與無環境檔鏡像，避免改寫開發伺服器持有的 DLL。 */
export function createLiveQaIsolation(label = 'live-integration') {
  const root = process.cwd();
  const temp = path.join(root, 'tmp', `${label}-${randomUUID()}`);
  fs.mkdirSync(temp, { recursive: true });
  for (const dir of ['tmp', 'home', 'profile', 'app-data', 'local-app-data']) fs.mkdirSync(path.join(temp, dir));
  const env = { ...buildIsolatedEnvironment(temp), SENTRY_DISABLE_AUTO_UPLOAD: 'true' };
  const client = path.join(temp, 'generated-client');
  const schema = fs.readFileSync(path.join(root, 'prisma/schema.prisma'), 'utf8');
  fs.writeFileSync(path.join(temp, 'schema.prisma'), schema.replace('provider = "prisma-client-js"', `provider = "prisma-client-js"\n  output = ${JSON.stringify(client)}`));
  fs.writeFileSync(path.join(temp, 'prisma.config.mjs'), `import {defineConfig} from ${JSON.stringify(path.join(root, 'node_modules/prisma/config.js'))}; export default defineConfig({schema:'./schema.prisma',engine:'classic',datasource:{url:'postgresql://postgres:postgres@127.0.0.1:54329/celebratedeal_ci?schema=public'}});`);
  const mirror = path.join(temp, 'source');
  fs.mkdirSync(mirror);
  const filter = source => !path.basename(source).startsWith('.env') && !['node_modules', '.git'].includes(path.basename(source)) && !fs.lstatSync(source).isSymbolicLink();
  for (const dir of ['src', 'scripts', 'tests']) fs.cpSync(path.join(root, dir), path.join(mirror, dir), { recursive: true, filter });
  // Include all root TypeScript inputs, not just a handpicked subset of app files.
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isFile() && !entry.name.startsWith('.env') && (/\.(?:ts|tsx|mts)$/.test(entry.name) || ['package.json', 'tsconfig.json'].includes(entry.name))) fs.copyFileSync(path.join(root, entry.name), path.join(mirror, entry.name));
  }
  fs.mkdirSync(path.join(mirror, 'public'));
  fs.copyFileSync(path.join(root, 'public/manifest.json'), path.join(mirror, 'public/manifest.json'));
  const config = JSON.parse(fs.readFileSync(path.join(mirror, 'tsconfig.json'), 'utf8'));
  config.compilerOptions.paths['@prisma/client'] = [path.join(client, 'index.d.ts')];
  fs.writeFileSync(path.join(mirror, 'tsconfig.json'), JSON.stringify(config));
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(mirror, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  return { root, temp, mirror, client, env, schemaSha256: createHash('sha256').update(schema).digest('hex') };
}

export function runLiveQaNode(isolation, args, cwd = isolation.root, extraEnv = {}) {
  const result = spawnSync(process.execPath, args, { cwd, env: { ...isolation.env, ...extraEnv }, encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
  return { exitCode: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '', errorCode: result.error?.code ?? null };
}

export function checkLiveQaTypes(isolation) {
  const phases = {};
  for (const [name, args, cwd] of [
    ['generate', [path.join(isolation.root, 'node_modules/prisma/build/index.js'), 'generate', '--config', path.join(isolation.temp, 'prisma.config.mjs')], isolation.temp],
    ['typegen', [path.join(isolation.root, 'node_modules/next/dist/bin/next'), 'typegen'], isolation.mirror],
    ['typecheck', [path.join(isolation.root, 'node_modules/typescript/bin/tsc'), '--noEmit'], isolation.mirror],
  ]) {
    const result = runLiveQaNode(isolation, args, cwd);
    phases[name] = result.exitCode;
    process.stdout.write(`${name}: exit ${result.exitCode}\n`);
    if (result.exitCode !== 0) { process.stdout.write(result.stdout); process.stderr.write(result.stderr); break; }
  }
  return phases;
}

/** 真正 domain 與 tests 保持原始來源，只替換產生的 client；不載入 dotenv。 */
export function writeLiveQaVitestConfig(isolation) {
  const target = path.join(isolation.temp, 'vitest.config.mts');
  fs.writeFileSync(target, `import {mergeConfig} from ${JSON.stringify(path.join(isolation.root, 'node_modules/vitest/dist/config.js'))};
import base from ${JSON.stringify(path.join(isolation.root, 'vitest.config.ts'))};
export default mergeConfig(base,{root:${JSON.stringify(isolation.root)},envDir:false,resolve:{alias:{'@prisma/client':${JSON.stringify(path.join(isolation.client, 'index.js'))}}}});`);
  return target;
}
