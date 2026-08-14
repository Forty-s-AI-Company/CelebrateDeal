import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  CLASSIFICATIONS,
  cleanupTemp,
  classifyOutcome,
  detectDisallowedExports,
  environment,
  extractAllowedRouteExports,
  inspectMirror,
  isForbiddenPath,
  mirrorFilter,
  sanitizeText,
  sourceIntegrity,
} from "./wp136-temp-next-type-generation-runner.mjs";

const validator = `type RouteHandlerConfig = {\n  GET?: unknown\n  POST?: unknown\n  DELETE?: unknown\n}\n// Validate src/app/api/cloudflare/stream-webhook/route.ts\n{ const handler = {} as typeof import("../../src/app/api/cloudflare/stream-webhook/route.js")\n handler satisfies RouteHandlerConfig<"/api/cloudflare/stream-webhook">\n}`;

test("extracts the generated route-handler contract only for the exact marker", () => {
  const contract = extractAllowedRouteExports(validator);
  assert.equal(contract.markerFound, true);
  assert.equal(contract.routeContract, "/api/cloudflare/stream-webhook");
  assert.deepEqual(contract.allowed, ["DELETE", "GET", "POST"]);
  assert.equal(extractAllowedRouteExports(validator, "src/app/other/route.ts").markerFound, false);
});

test("detects one disallowed export and preserves normalized metadata", () => {
  const source = [{ name: "POST", kind: "const" }, { name: "createCloudflareStreamWebhookHandler", kind: "function" }];
  const disallowed = detectDisallowedExports(source, ["POST", "GET", "DELETE"]);
  assert.equal(disallowed.length, 1);
  assert.equal(disallowed[0].name, "createCloudflareStreamWebhookHandler");
});

test("accepts only exact dirty-hunk or clean ownership outcomes", () => {
  assert.equal(classifyOutcome({ generatedPresent: true, generatedContract: { markerFound: true }, disallowed: [{ name: "create" }], ownership: { ownership: "PRESERVE_ONLY_DIRTY", symbolSpanOverlapsDirtyHunk: true } }), CLASSIFICATIONS.EXACT_PRESERVE_ONLY_NO_GO);
  assert.equal(classifyOutcome({ generatedPresent: true, generatedContract: { markerFound: true }, disallowed: [{ name: "create" }], ownership: { ownership: "TRACKED_CLEAN", symbolSpanOverlapsDirtyHunk: false } }), CLASSIFICATIONS.CLEAN_SEPARABLE_CANDIDATE);
  assert.equal(classifyOutcome({ generatedPresent: true, generatedContract: { markerFound: true }, disallowed: [{ name: "a" }, { name: "b" }], ownership: null }), CLASSIFICATIONS.UNKNOWN_FAIL_CLOSED);
});

test("sanitizes output without retaining paths or hidden values", () => {
  const safe = sanitizeText("C:\\Users\\eden\\.env.local TOKEN=secret https://example.invalid");
  assert.equal(safe.includes("C:\\Users"), false);
  assert.equal(safe.includes("secret"), false);
  assert.equal(safe.includes("example.invalid"), false);
});

test("WP136 mirror policy rejects generated, dotenv and sensitive paths", () => {
  assert.equal(isForbiddenPath("src/app/page.tsx"), false);
  assert.equal(isForbiddenPath(".next/types/routes.d.ts"), true);
  assert.equal(isForbiddenPath(".env.local"), true);
  assert.equal(isForbiddenPath("certs/service.key"), true);
  assert.equal(mirrorFilter(path.join(process.cwd(), "src", "app", "page.tsx")), true);
  assert.equal(mirrorFilter(path.join(process.cwd(), ".next", "types", "routes.d.ts")), false);
});

test("WP136 mirror inspection and cleanup remain bounded to OS temp", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wp136-cov10-"));
  try {
    fs.mkdirSync(path.join(tempRoot, ".next", "types"), { recursive: true });
    fs.writeFileSync(path.join(tempRoot, ".env.local"), "synthetic-only");
    const inspection = inspectMirror(tempRoot);
    assert.ok(inspection.missing.includes("package.json"));
    assert.ok(inspection.forbiddenCopied.includes(".env.local"));
    assert.ok(inspection.forbiddenCopied.some((entry) => entry.startsWith(".next/")));
  } finally {
    assert.equal(cleanupTemp(tempRoot), true);
    assert.equal(fs.existsSync(tempRoot), false);
  }
});

test("WP136 synthetic environment and source integrity stay disposable", () => {
  const tempRoot = path.join(os.tmpdir(), "wp136-cov10-env");
  const env = environment(tempRoot);
  assert.equal(env.NODE_ENV, "production");
  assert.equal(env.CI, "true");
  assert.equal(env.NPM_CONFIG_OFFLINE, "true");
  assert.match(env.DATABASE_URL, /127\.0\.0\.1:54329\/wp136_typegen/);
  assert.equal(env.TEMP, path.join(tempRoot, "tmp"));
  const integrity = sourceIntegrity();
  assert.ok(integrity["package.json"].match(/^[a-f0-9]{64}$/));
  assert.ok(integrity["src/app/api/cloudflare/stream-webhook/route.ts"].match(/^[a-f0-9]{64}$/));
});
