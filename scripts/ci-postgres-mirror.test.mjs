import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';

test('official pinned mirror preserves the entire existing CI contract and disposable tag', () => {
  const image = 'public.ecr.aws/docker/library/postgres@sha256:1a66d744c1b459e13b05a8fca341da84cb63383e99ce262210efee5a319d4551';
  const current = readFileSync('.github/workflows/ci.yml', 'utf8').replaceAll('\r\n', '\n');
  const prior = execFileSync('git', ['show', '577a5df52e7d33e73b67896bf27f5d0980544a17:.github/workflows/ci.yml'], { encoding: 'utf8' }).replaceAll('\r\n', '\n');
  assert.equal(current.match(new RegExp(image, 'g'))?.length, 2);
  let restored = current.replace('        # Docker Official Images mirror; pinned Linux amd64 PostgreSQL 16 Alpine.\n', '')
    .replace(`        image: ${image}`, '        image: postgres:16-alpine')
    .replace(`      - name: Bind official mirror to existing disposable PostgreSQL runner tag\n        # Keep existing runner/ancestor contracts using exactly the same image.\n        run: docker tag ${image} postgres:16-alpine\n\n`, '');
  // Keep all prior gates byte-for-byte, while checking each new owned gate
  // independently for its exact command, uniqueness and execution order.
  const additions = [
    ['Q1 original refund proof database isolation', 'scripts/q1-original-refund-proof-disposable-qa.mjs'],
    ['Q1 original refund reservation database isolation', 'scripts/q1-original-refund-target-disposable-qa.mjs'],
  ];
  let preceding = current.indexOf('      - name: Install Playwright browser');
  for (const [name, script] of additions) {
    const block = '      - name: ' + name + '\n        run: node ' + script + '\n\n';
    const occurrences = current.split(block).length - 1;
    assert.equal(occurrences, existsSync(script) ? 1 : 0, name + ': exactly one gate for its owned runner');
    if (occurrences) {
      const position = current.indexOf(block);
      assert.ok(position > preceding, name + ': follows browser setup and earlier fixed gates');
      assert.ok(position < current.indexOf('      - name: Referral sharing database and browser gate'), name + ': runs before existing browser gates');
      preceding = position;
      restored = restored.replace(block, '');
    }
  }

  assert.equal(restored, prior, 'all database health, migrations, test assertions and existing steps remain intact');
});

test('forward gates reject missing, duplicate, altered and reordered gates without weakening historical checks', () => {
  const source = readFileSync(new URL(import.meta.url), 'utf8');
  const base = source.slice(0, source.indexOf("\ntest('forward gates reject"));
  const current = readFileSync('.github/workflows/ci.yml', 'utf8').replaceAll('\r\n', '\n');
  const gates = [
    ['Q1 original refund proof database isolation', 'scripts/q1-original-refund-proof-disposable-qa.mjs'],
    ['Q1 original refund reservation database isolation', 'scripts/q1-original-refund-target-disposable-qa.mjs'],
  ];
  const mutations = [current.replace('--health-retries=5', '--health-retries=1')];
  for (const [name, script] of gates) {
    const block = '      - name: ' + name + '\n        run: node ' + script + '\n\n';
    if (!current.includes(block)) continue;
    mutations.push(current.replace(block, ''), current + block,
      current.replace(block, block.replace('run: node ', 'run: echo ')),
      current.replace(block, '') + block);
  }
  for (const mutated of mutations) {
    const program = base.replace("readFileSync('.github/workflows/ci.yml', 'utf8')", () => JSON.stringify(mutated));
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', program], {
      cwd: process.cwd(), encoding: 'utf8', timeout: 15000, windowsHide: true,
      env: { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', ComSpec: process.env.ComSpec ?? '', PATHEXT: process.env.PATHEXT ?? '' },
    });
    assert.equal(child.error, undefined, 'the contract actually runs for the altered workflow');
    assert.notEqual(child.status, 0, 'every unsafe workflow change is rejected');
  }
});
