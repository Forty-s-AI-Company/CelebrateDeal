import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

test('official pinned mirror preserves the entire existing CI contract and disposable tag', () => {
  const image = 'public.ecr.aws/docker/library/postgres@sha256:1a66d744c1b459e13b05a8fca341da84cb63383e99ce262210efee5a319d4551';
  const current = readFileSync('.github/workflows/ci.yml', 'utf8').replaceAll('\r\n', '\n');
  const prior = execFileSync('git', ['show', '577a5df52e7d33e73b67896bf27f5d0980544a17:.github/workflows/ci.yml'], { encoding: 'utf8' }).replaceAll('\r\n', '\n');
  assert.equal(current.match(new RegExp(image, 'g'))?.length, 2);
  const restored = current.replace('        # Docker Official Images mirror; pinned Linux amd64 PostgreSQL 16 Alpine.\n', '')
    .replace(`        image: ${image}`, '        image: postgres:16-alpine')
    .replace(`      - name: Bind official mirror to existing disposable PostgreSQL runner tag\n        # Keep existing runner/ancestor contracts using exactly the same image.\n        run: docker tag ${image} postgres:16-alpine\n\n`, '');
  assert.equal(restored, prior, 'all database health, migrations, test assertions and existing steps remain intact');
});
