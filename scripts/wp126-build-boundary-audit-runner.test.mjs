import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { commandSummary, environment, excludedFile, inventory, pathMetadata, relative } from "./wp126-build-boundary-audit-runner.mjs";

test("WP126 exclusion and environment helpers remain fixed and synthetic", () => {
  assert.equal(excludedFile(".env.local"), "dotenv");
  assert.equal(excludedFile("server.p12"), "private_key_or_certificate");
  assert.equal(excludedFile("cache.sqlite"), "database_file");
  assert.equal(excludedFile("page.tsx"), null);
  const env = environment();
  assert.equal(env.NODE_ENV, "production");
  assert.equal(env.VERCEL_ENV, "preview");
  assert.equal(env.NPM_CONFIG_OFFLINE, "true");
  assert.equal(Object.keys(env).some((key) => /^COOKIE$|TOKEN$|PASSWORD$/i.test(key)), false);
  assert.equal(relative(path.resolve("package.json")), "package.json");
});

test("WP126 command summary strips output and preserves only bounded execution metadata", () => {
  assert.deepEqual(commandSummary(null), null);
  assert.deepEqual(commandSummary({ exitCode: 1, signal: null, timedOut: false, durationMs: 12, outputDigest: "sha256:synthetic", outputLineCount: 2, output: "raw" }), {
    exitCode: 1,
    signal: null,
    timedOut: false,
    durationMs: 12,
    outputDigest: "sha256:synthetic",
    outputLineCount: 2,
  });
});

test("WP126 path metadata stays read-only and inventory is value-free", () => {
  const metadata = pathMetadata(["docs/launch/wp126-build-boundary-audit-contract.json", "missing.synthetic"]);
  assert.equal(metadata["docs/launch/wp126-build-boundary-audit-contract.json"].dirty, false);
  assert.equal(metadata["missing.synthetic"].dirty, false);
  const current = inventory();
  assert.equal(Array.isArray(current.entries), true);
  assert.equal(Array.isArray(current.digests), true);
  assert.equal(current.digests.every((entry) => !Object.hasOwn(entry, "contents")), true);
});

test("WP126 temp fixture paths are represented without external execution", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "celebratedeal-wp126-test-"));
  try {
    await fsp.writeFile(path.join(root, "receipt.json"), JSON.stringify({ status: "synthetic" }));
    assert.equal((await fsp.stat(path.join(root, "receipt.json"))).isFile(), true);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});
