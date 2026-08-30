import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { artifacts, digestInventory, excludedFileClass, relative, requiredInputs, statusEntries, syntheticEnvironment } from "./wp125-no-dotenv-diagnostic-runner.mjs";

test("WP125 exclusion classifier and relative path contract are deterministic", () => {
  assert.equal(excludedFileClass(".env.preview"), "dotenv");
  assert.equal(excludedFileClass("private.key"), "private_key_or_certificate");
  assert.equal(excludedFileClass("snapshot.db"), "database_file");
  assert.equal(excludedFileClass("route.ts"), null);
  assert.equal(relative(path.resolve("package.json")), "package.json");
});

test("WP125 synthetic environment contains only fixed non-production values", () => {
  const environment = syntheticEnvironment();
  assert.equal(environment.NODE_ENV, "production");
  assert.equal(environment.VERCEL_ENV, "preview");
  assert.equal(environment.NPM_CONFIG_OFFLINE, "true");
  assert.equal(Object.keys(environment).some((key) => /^COOKIE$|TOKEN$|PASSWORD$/i.test(key)), false);
});

test("WP125 required inputs and artifact parser fail closed on incomplete fixtures", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "celebratedeal-wp125-test-"));
  try {
    await fsp.mkdir(path.join(root, "src", "app"), { recursive: true });
    await fsp.mkdir(path.join(root, "prisma"), { recursive: true });
    await fsp.writeFile(path.join(root, "package.json"), "{}");
    await fsp.writeFile(path.join(root, "next.config.ts"), "export default {};");
    await fsp.writeFile(path.join(root, "tsconfig.json"), "{}");
    await fsp.writeFile(path.join(root, "prisma", "schema.prisma"), "datasource db { provider = \"sqlite\" url = \"file:dev.db\" }");
    assert.deepEqual(requiredInputs(root), ["public"]);
    await fsp.mkdir(path.join(root, "public"), { recursive: true });
    await fsp.mkdir(path.join(root, ".next", "server"), { recursive: true });
    await fsp.writeFile(path.join(root, ".next", "BUILD_ID"), "build");
    await fsp.writeFile(path.join(root, ".next", "build-manifest.json"), "{}");
    await fsp.writeFile(path.join(root, ".next", "routes-manifest.json"), "{}");
    await fsp.writeFile(path.join(root, ".next", "server", "app-paths-manifest.json"), "not-json");
    const result = artifacts(root);
    assert.equal(result.pass, false);
    assert.equal(result.values.at(-1).parseable, false);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("WP125 digest inventory is value-free for sensitive names and hashed for safe names", () => {
  const result = digestInventory([".env.local", "package.json", "missing.synthetic"]);
  assert.deepEqual(result[0], { path: ".env.local", pathOnly: true });
  assert.match(result[1].sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(result[2], { path: "missing.synthetic", unreadable: true });
  assert.equal(Array.isArray(statusEntries()), true);
});
