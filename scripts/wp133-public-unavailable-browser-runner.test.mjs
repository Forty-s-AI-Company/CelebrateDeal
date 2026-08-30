import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  allocatePort,
  CLASSIFICATIONS,
  classifyResult,
  digest,
  environment,
  filterSourcePath,
  fixtureScript,
  inspectMirror,
  isForbiddenPath,
  playwrightConfig,
  removeTempRoot,
  sanitizeDiagnosticText,
  sourceIntegrity,
} from "./wp133-public-unavailable-browser-runner.mjs";

const passing = {
  preflight: { digestMatch: true, stagedIndexEmpty: true },
  mirror: { missing: [], forbiddenCopied: [] },
  junction: { ok: true },
  resolution: { ok: true },
  port: { ok: true },
  database: { containerAvailable: true, schemaReady: true },
  server: { spawned: true, spawnError: null, exitBeforeReady: false },
  browser: { ok: true },
  cleanup: { ok: true },
};

test("accepts only a complete local browser contract", () => {
  assert.equal(classifyResult(passing), CLASSIFICATIONS.PASS);
});

test("fails closed on digest, mirror, server, browser, or cleanup boundaries", () => {
  assert.equal(classifyResult({ ...passing, preflight: { digestMatch: false, stagedIndexEmpty: true } }), CLASSIFICATIONS.DIGEST_MISMATCH);
  assert.equal(classifyResult({ ...passing, mirror: { missing: ["package.json"], forbiddenCopied: [] } }), CLASSIFICATIONS.MIRROR_INPUT_MISSING);
  assert.equal(classifyResult({ ...passing, server: { spawned: true, spawnError: null, exitBeforeReady: true } }), CLASSIFICATIONS.SERVER_PRE_READINESS_EXIT);
  assert.equal(classifyResult({ ...passing, browser: { ok: false } }), CLASSIFICATIONS.BROWSER_CONTRACT_FAILURE);
  assert.equal(classifyResult({ ...passing, cleanup: { ok: false } }), CLASSIFICATIONS.CLEANUP_FAILURE);
});

test("sanitizes diagnostics and never keeps secret-like values", () => {
  const sanitized = sanitizeDiagnosticText("C:\\Users\\eden\\.env.local TOKEN=secret https://example.test " + ["postgres", "://"].join("") + "user:pass@example.invalid/db");
  assert.equal(sanitized.includes("C:\\Users"), false);
  assert.equal(sanitized.includes("secret"), false);
  assert.equal(sanitized.includes("example.test"), false);
  assert.equal(sanitized.includes("user:pass"), false);
});

// COV-09 BEGIN
test("WP133 mirror filters fail closed for generated, dotenv and private paths", () => {
  assert.equal(filterSourcePath("src/app/page.tsx"), true);
  assert.equal(filterSourcePath(".next/BUILD_ID"), false);
  assert.equal(filterSourcePath("node_modules"), false);
  assert.equal(filterSourcePath(".env.local"), false);
  assert.equal(isForbiddenPath("certs/service.key"), true);
  assert.equal(isForbiddenPath("src/.next-safe/page.tsx"), false);
});

test("WP133 required-input inspection reports missing and forbidden mirror entries", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "celebratedeal-wp133-inspect-"));
  const required = [
    "package.json",
    "next.config.ts",
    "tsconfig.json",
    "prisma/schema.prisma",
    "src/app/p/[slug]/page.tsx",
    "src/components/team-funnel-public-page.tsx",
    "tests/e2e/wp128-public-partner-unavailable-state.spec.ts",
  ];
  try {
    for (const relative of required) {
      const target = path.join(tempRoot, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, `synthetic:${relative}\n`, "utf8");
    }
    const clean = inspectMirror(tempRoot);
    assert.deepEqual(clean.missing, []);
    assert.deepEqual(clean.forbiddenCopied, []);
    assert.equal(Object.keys(clean.sourceDigests).length, required.length);

    fs.writeFileSync(path.join(tempRoot, ".env.local"), "never-read", "utf8");
    const unsafe = inspectMirror(tempRoot);
    assert.deepEqual(unsafe.forbiddenCopied, [".env.local"]);
    assert.match(digest(path.join(tempRoot, required[0])), /^[0-9a-f]{64}$/);
  } finally {
    assert.equal(removeTempRoot(tempRoot), true);
  }
});

test("WP133 synthetic environment, fixture script and Playwright config remain bounded", () => {
  const tempRoot = path.join(os.tmpdir(), "celebratedeal-wp133-config");
  const env = environment(tempRoot, 32133, "postgresql://synthetic@127.0.0.1/db");
  assert.equal(env.CI, "true");
  assert.equal(env.NPM_CONFIG_OFFLINE, "true");
  assert.equal(env.DATABASE_URL, "postgresql://synthetic@127.0.0.1/db");
  assert.match(fixtureScript(false), /const vendorId = \(await db\.vendor\.findUnique/);
  assert.match(fixtureScript(true), /deleteMany/);
  assert.match(playwrightConfig(tempRoot), /fullyParallel: false/);
  assert.match(playwrightConfig(tempRoot), /browserName: "chromium"/);
  const integrity = sourceIntegrity();
  assert.equal(typeof integrity["src/components/team-funnel-public-page.tsx"], "string");
  assert.match(integrity["tests/e2e/wp128-public-partner-unavailable-state.spec.ts"], /^[0-9a-f]{64}$/);
});

test("WP133 allocates one loopback ephemeral port without external calls", async () => {
  const result = await allocatePort();
  assert.equal(result.ephemeral, true);
  assert.equal(result.ok, true);
  assert.equal(Number.isInteger(result.port), true);
  assert.ok(result.port > 0);
});
// COV-09 END
