import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  artifactSummary,
  classifyExcluded,
  containsForbiddenFiles,
  digestPath,
  hostEnvironment,
  isSensitivePath,
  relative,
  shouldExclude,
  stableEqual,
  statusPath,
} from "./wp124-no-dotenv-build-runner.mjs";

test("WP124 exclusion classifier is closed over dotenv, private and database files", () => {
  assert.equal(classifyExcluded(".env.local"), "dotenv");
  assert.equal(classifyExcluded("service-account.json"), "private_key_or_certificate");
  assert.equal(classifyExcluded("data.sqlite"), "database_file");
  assert.equal(classifyExcluded("page.tsx"), null);
  assert.equal(shouldExclude("src/page.tsx", ["src"]), null);
  assert.equal(shouldExclude(".env.local", [".env.local"]), "dotenv");
  assert.equal(shouldExclude("src/page.tsx", ["src", "node_modules"]), "build_output");
});

test("WP124 digest and status helpers never read sensitive file content", () => {
  assert.equal(statusPath(" M src/page.tsx"), "src/page.tsx");
  assert.equal(statusPath("R  old.ts -> src/new.ts"), "src/new.ts");
  assert.equal(isSensitivePath(".env.local"), true);
  assert.deepEqual(digestPath(".env.local"), { path: ".env.local", pathOnly: true });
  const packageDigest = digestPath("package.json");
  assert.equal(packageDigest.path, "package.json");
  assert.match(packageDigest.sha256, /^[0-9a-f]{64}$/);
  assert.equal(relative(path.resolve("package.json")), "package.json");
});

test("WP124 artifact summary and forbidden-file scan are deterministic on disposable fixtures", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "celebratedeal-wp124-test-"));
  try {
    await fsp.mkdir(path.join(root, ".next", "server"), { recursive: true });
    await fsp.writeFile(path.join(root, ".next", "BUILD_ID"), "build");
    await fsp.writeFile(path.join(root, ".next", "build-manifest.json"), "{}");
    await fsp.writeFile(path.join(root, ".next", "routes-manifest.json"), "{}");
    await fsp.writeFile(path.join(root, ".next", "server", "app-paths-manifest.json"), "{}");
    await fsp.writeFile(path.join(root, ".env.local"), "never-read");
    const summary = artifactSummary(root);
    assert.equal(summary.pass, true);
    assert.equal(summary.artifacts.length, 4);
    const violations = containsForbiddenFiles(root);
    assert.equal(violations.length, 1);
    assert.match(violations[0], /[\\/]\.env\.local$/);
    assert.equal(stableEqual(summary, structuredClone(summary)), true);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("WP124 host environment is synthetic and allowlisted", () => {
  const environment = hostEnvironment();
  assert.equal(environment.NODE_ENV, "production");
  assert.equal(environment.VERCEL_ENV, "preview");
  assert.equal(environment.NPM_CONFIG_OFFLINE, "true");
  assert.equal(environment.npm_config_audit, "false");
  assert.equal(Object.keys(environment).some((key) => /^COOKIE$|TOKEN$|PASSWORD$/i.test(key)), false);
});
