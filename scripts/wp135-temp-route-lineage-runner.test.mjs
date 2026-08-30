import assert from "node:assert/strict";
import test from "node:test";
import {
  CLASSIFICATIONS,
  classifyResult,
  extractAllowedRouteExports,
  extractGeneratedInventory,
  mapGeneratedRouteContract,
  parseSourceExports,
} from "./wp135-temp-route-lineage-runner.mjs";

test("parses the route contract without a human-readable marker", () => {
  const validator = `type RouteHandlerConfig<Route extends string = string> = {\n  GET?: unknown\n  POST?: unknown\n  PUT?: unknown\n  PATCH?: unknown\n  DELETE?: unknown\n  HEAD?: unknown\n  OPTIONS?: unknown\n}\nconst handler = {} as typeof import("../../../../src/app/api/cloudflare/stream-webhook/route.js")\nhandler satisfies RouteHandlerConfig<"/api/cloudflare/stream-webhook">`;
  const mapping = mapGeneratedRouteContract(validator);
  assert.equal(mapping.mapped, true);
  assert.deepEqual(mapping.allowed, ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]);
});

test("rejects a wrong route or ambiguous target references", () => {
  const wrong = mapGeneratedRouteContract(`const handler = {} as typeof import("src/app/api/other/route.js")\nhandler satisfies RouteHandlerConfig<"/api/other">`);
  assert.equal(wrong.mapped, false);
  assert.match(wrong.reason, /TARGET_ROUTE_CONTRACT_NOT_FOUND|AMBIGUOUS_OR_WRONG_ROUTE/);
});

test("extracts only exported source symbols and their spans", () => {
  const symbols = parseSourceExports("export function createCloudflareStreamWebhookHandler() {}\nexport const POST = () => new Response();");
  assert.deepEqual(symbols.map((symbol) => symbol.name), ["createCloudflareStreamWebhookHandler", "POST"]);
  assert.ok(symbols.every((symbol) => symbol.startLine >= 1 && symbol.endLine >= symbol.startLine));
});

test("classifies an exact preserve-only overlap and never broadens it", () => {
  const generated = { inventoryComplete: true, targetReferences: [{ path: ".next/types/validator.ts" }] };
  const mapping = { mapped: true, allowed: ["POST"] };
  const sourceExports = [{ name: "createCloudflareStreamWebhookHandler", startLine: 10, endLine: 20 }];
  const ownership = { ownership: "PRESERVE_ONLY_DIRTY", symbolSpanOverlapsDirtyHunk: true };
  assert.equal(classifyResult({ generated, mapping, sourceExports, ownership }), CLASSIFICATIONS.EXACT_PRESERVE_ONLY_NO_GO);
});

test("classifies a complete generated inventory without the target as exact omission", () => {
  const generated = { inventoryComplete: true, targetReferences: [] };
  assert.equal(classifyResult({ generated, mapping: null, sourceExports: [], ownership: null }), CLASSIFICATIONS.TARGET_ROUTE_OMITTED_EXACT_NO_GO);
});

test("allowed route exports parser fails closed when the contract is absent", () => {
  assert.deepEqual(extractAllowedRouteExports("type Other = {}"), { found: false, allowed: [] });
});

test("inventory parser does not treat a missing generated directory as complete", () => {
  const inventory = extractGeneratedInventory("C:\\path\\that\\does\\not\\exist");
  assert.equal(inventory.inventoryComplete, false);
  assert.deepEqual(inventory.targetReferences, []);
});

test("COV-08 parses every exported TypeScript declaration kind deterministically", () => {
  const source = [
    "export function handle() {}",
    "export const POST = () => new Response();",
    "export class Handler {}",
    "export type Contract = string;",
    "export interface Input { value: string }",
    "export enum State { Ready }",
  ].join("\n");
  const symbols = parseSourceExports(source, "route.ts");
  assert.deepEqual(symbols.map((symbol) => [symbol.name, symbol.kind]), [
    ["Contract", "type"],
    ["handle", "function"],
    ["Handler", "class"],
    ["Input", "interface"],
    ["POST", "const"],
    ["State", "enum"],
  ]);
  assert.equal(symbols.every((symbol) => symbol.signatureFingerprint.length === 64), true);
});

test("COV-08 generated inventory records target hits and required generated files", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "wp135-cov08-"));
  try {
    const types = path.join(directory, ".next", "types");
    fs.mkdirSync(types, { recursive: true });
    fs.writeFileSync(path.join(types, "routes.d.ts"), "export type Routes = {};");
    fs.writeFileSync(path.join(types, "validator.ts"), "const h = {} as typeof import(\"src/app/api/cloudflare/stream-webhook/route.js\")");
    const result = extractGeneratedInventory(directory);
    assert.equal(result.inventoryComplete, true);
    assert.equal(result.requiredFilesPresent, true);
    assert.equal(result.targetReferences.length, 1);
    assert.equal(result.targetReferences[0].sourceImportHit, true);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("COV-08 route classification accepts one clean disallowed export and rejects ambiguity", () => {
  const generated = { inventoryComplete: true, targetReferences: [{ path: ".next/types/validator.ts" }] };
  const mapping = { mapped: true, allowed: ["POST"] };
  const sourceExports = [{ name: "POST" }, { name: "unused" }];
  assert.equal(classifyResult({ generated, mapping, sourceExports, ownership: { ownership: "TRACKED_CLEAN", symbolSpanOverlapsDirtyHunk: false } }), CLASSIFICATIONS.CLEAN_SEPARABLE_CANDIDATE);
  assert.equal(classifyResult({ generated, mapping, sourceExports: [{ name: "unused1" }, { name: "unused2" }], ownership: { ownership: "TRACKED_CLEAN", symbolSpanOverlapsDirtyHunk: false } }), CLASSIFICATIONS.UNKNOWN_FAIL_CLOSED);
});
