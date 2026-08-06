import assert from "node:assert/strict";
import test from "node:test";
import { CLASSIFICATIONS, classifyResult, detectDisallowedExports, mapGeneratedRouteContract } from "./wp137-next-generated-route-scope-audit.mjs";

test("maps a target validator reference without relying on a comment marker", () => {
  const files = [{ path: ".next/types/validator.ts", targetHit: true, routeHandlerConfig: true }, { path: ".next/types/routes.d.ts", targetHit: true, routeHandlerConfig: false }];
  const mapping = mapGeneratedRouteContract(files, [{ name: "POST", kind: "const" }, { name: "createCloudflareStreamWebhookHandler", kind: "function" }]);
  assert.equal(mapping.mapped, true);
  assert.equal(mapping.candidate.name, "createCloudflareStreamWebhookHandler");
});

test("does not treat missing target references as a successful mapping", () => {
  const generated = { inventoryComplete: true, targetReferences: [] };
  assert.equal(classifyResult({ generated, mapping: { mapped: false }, ownership: null }), CLASSIFICATIONS.TARGET_ROUTE_OMITTED_EXACT_NO_GO);
});

test("ambiguous export sets fail closed", () => {
  const generated = { inventoryComplete: true, targetReferences: [{ path: ".next/types/validator.ts" }] };
  const mapping = mapGeneratedRouteContract([{ path: ".next/types/validator.ts", targetHit: true, routeHandlerConfig: true }], [{ name: "POST", kind: "const" }, { name: "A", kind: "function" }, { name: "B", kind: "function" }]);
  assert.equal(mapping.mapped, false);
  assert.equal(classifyResult({ generated, mapping, ownership: null }), CLASSIFICATIONS.UNKNOWN_FAIL_CLOSED);
});

test("target route contract is not inferred from an empty export list", () => {
  const disallowed = detectDisallowedExports([{ name: "POST" }], []);
  assert.equal(disallowed.length, 1);
});
