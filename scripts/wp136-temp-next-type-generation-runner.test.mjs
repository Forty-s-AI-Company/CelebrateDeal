import assert from "node:assert/strict";
import test from "node:test";
import { CLASSIFICATIONS, classifyOutcome, detectDisallowedExports, extractAllowedRouteExports, sanitizeText } from "./wp136-temp-next-type-generation-runner.mjs";

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
