import assert from "node:assert/strict";
import test from "node:test";
import { environment, fixtureScript, run } from "./wp128-public-partner-unavailable-state-runner.mjs";

test("WP128 synthetic environment stays offline and loopback-only", () => {
  const env = environment();
  assert.equal(env.NODE_ENV, "development");
  assert.equal(env.CI, "true");
  assert.equal(env.NPM_CONFIG_OFFLINE, "true");
  assert.equal(env.PSQLRC, "");
  assert.match(env.DATABASE_URL, /^postgresql:\/\/postgres:postgres@127\.0\.0\.1:54329\//);
  assert.match(env.NEXT_PUBLIC_APP_URL, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.equal(env.NEXT_PUBLIC_APP_URL, env.E2E_BASE_URL);
});

test("WP128 fixture scripts keep create and cleanup paths distinct", () => {
  const create = fixtureScript(false);
  const cleanup = fixtureScript(true);
  assert.match(create, /vendor\.create/);
  assert.match(create, /partnerFunnelPage\.create/);
  assert.match(cleanup, /partnerFunnelPage\.deleteMany/);
  assert.match(cleanup, /vendor\.deleteMany/);
  assert.equal(create.includes("DROP SCHEMA"), false);
  assert.equal(cleanup.includes("DROP SCHEMA"), false);
});

test("WP128 command wrapper reports bounded local success and failure", () => {
  const success = run(process.execPath, ["-e", "process.stdout.write('synthetic-ok')"], {});
  assert.equal(success.exitCode, 0);
  assert.equal(success.stdout, "synthetic-ok");
  assert.equal(success.stderr, "");

  const failure = run(process.execPath, ["-e", "process.stderr.write('synthetic-failure'); process.exitCode = 7"], {});
  assert.equal(failure.exitCode, 7);
  assert.equal(failure.stdout, "");
  assert.equal(failure.stderr, "synthetic-failure");
});
