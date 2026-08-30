import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  CLASSIFICATIONS,
  ROLES,
  classifyAstRoleFixture,
  classifyReferenceMetadata,
  cleanupTemp,
  copyTree,
  digestFile,
  isForbiddenMirrorPath,
  isAllowedOutcome,
  normalizeRelativePath,
  pathSegments,
  resolveCanonicalSourcePath,
} from "./wp138-generated-target-reference-resolver.mjs";

const target = "src/app/api/cloudflare/stream-webhook/route.ts";
const routeKey = "/api/cloudflare/stream-webhook";

test("canonicalizes relative import separators and extensions", () => {
  assert.equal(resolveCanonicalSourcePath("../../src/app/api/cloudflare/stream-webhook/route.js"), target);
  assert.equal(resolveCanonicalSourcePath("..\\..\\src\\app\\api\\cloudflare\\stream-webhook\\route.ts"), target);
  assert.equal(resolveCanonicalSourcePath("../../src/app/api/other/route.js"), "src/app/api/other/route.ts");
});

test("recognizes the contract-bearing validator without comments", () => {
  const text = `const handler = {} as typeof import("../../src/app/api/cloudflare/stream-webhook/route.js")\nhandler satisfies RouteHandlerConfig<"${routeKey}">`;
  const metadata = classifyAstRoleFixture({ generatedPath: ".next/types/validator.ts", text, sourceDigest: "digest" });
  assert.equal(metadata.generatedFileRole, ROLES.ROUTE_CONTRACT_VALIDATOR);
  assert.equal(metadata.contractBearing, true);
  assert.equal(metadata.canonicalSourcePath, target);
  assert.equal(metadata.routeKey, routeKey);
});

test("classifies a route inventory reference as non-contract", () => {
  const metadata = classifyAstRoleFixture({ generatedPath: ".next/types/routes.d.ts", text: `type Routes = "${routeKey}"`, sourceDigest: "digest" });
  assert.equal(metadata.generatedFileRole, ROLES.ROUTE_INVENTORY);
  assert.equal(metadata.contractBearing, false);
  assert.equal(metadata.exclusionReason, "NON_CONTRACT_ROUTE_INVENTORY");
});

test("selects one contract reference independently of reference order", () => {
  const validator = { generatedFileRole: ROLES.ROUTE_CONTRACT_VALIDATOR, contractBearing: true };
  const inventory = { generatedFileRole: ROLES.ROUTE_INVENTORY, contractBearing: false };
  assert.equal(classifyReferenceMetadata([validator, inventory]).classification, CLASSIFICATIONS.EXACT_SINGLE_ROUTE_REFERENCE_MAPPED);
  assert.equal(classifyReferenceMetadata([inventory, validator]).classification, CLASSIFICATIONS.EXACT_SINGLE_ROUTE_REFERENCE_MAPPED);
});

test("rejects zero or multiple contract references as exact no-go", () => {
  const inventory = { generatedFileRole: ROLES.ROUTE_INVENTORY, contractBearing: false };
  const validator = { generatedFileRole: ROLES.ROUTE_CONTRACT_VALIDATOR, contractBearing: true };
  assert.equal(classifyReferenceMetadata([inventory, inventory]).classification, CLASSIFICATIONS.REFERENCE_ROLE_EXACT_NO_GO);
  assert.equal(classifyReferenceMetadata([validator, validator]).classification, CLASSIFICATIONS.REFERENCE_ROLE_EXACT_NO_GO);
});

test("fails closed on unknown roles and wrong reference counts", () => {
  assert.equal(classifyReferenceMetadata([{ generatedFileRole: ROLES.UNKNOWN }, { generatedFileRole: ROLES.ROUTE_INVENTORY }]).classification, CLASSIFICATIONS.UNKNOWN_FAIL_CLOSED);
  assert.equal(classifyReferenceMetadata([{ generatedFileRole: ROLES.ROUTE_INVENTORY }]).classification, CLASSIFICATIONS.UNKNOWN_FAIL_CLOSED);
  assert.equal(isAllowedOutcome(CLASSIFICATIONS.UNKNOWN_FAIL_CLOSED), false);
});

test("does not rely on ordering or comment markers", () => {
  const text = `const handler = {} as typeof import("../../src/app/api/cloudflare/stream-webhook/route.js")\nhandler satisfies RouteHandlerConfig<"${routeKey}">`;
  const withoutMarker = classifyAstRoleFixture({ generatedPath: ".next/types/validator.ts", text, sourceDigest: "digest" });
  const withDifferentComment = classifyAstRoleFixture({ generatedPath: ".next/types/validator.ts", text: `// not a route marker\n${text}`, sourceDigest: "digest" });
  assert.equal(withoutMarker.generatedFileRole, withDifferentComment.generatedFileRole);
  assert.equal(withoutMarker.canonicalSourcePath, withDifferentComment.canonicalSourcePath);
});

test("fails closed for missing source markers and unsupported route extensions", () => {
  assert.equal(resolveCanonicalSourcePath("node_modules/other/route.js"), null);
  assert.equal(resolveCanonicalSourcePath("src/app/api/cloudflare/stream-webhook/route.mjs"), target.replace(/\.ts$/u, ".mjs"));
  assert.equal(resolveCanonicalSourcePath(null), null);
});

test("classifies shared type support separately from contract-bearing validators", () => {
  const metadata = classifyAstRoleFixture({
    generatedPath: ".next/types/shared.d.ts",
    text: `type Route = "${routeKey}";`,
    sourceDigest: "digest",
  });
  assert.equal(metadata.generatedFileRole, ROLES.SHARED_TYPE_SUPPORT);
  assert.equal(metadata.contractBearing, false);
  assert.equal(metadata.exclusionReason, "NON_CONTRACT_SHARED_SUPPORT");
  assert.equal(isAllowedOutcome(CLASSIFICATIONS.REFERENCE_ROLE_EXACT_NO_GO), true);
  assert.equal(isAllowedOutcome("UNEXPECTED"), false);
});

test("rejects reference collections with the wrong cardinality or unknown role", () => {
  assert.deepEqual(classifyReferenceMetadata([]), {
    classification: CLASSIFICATIONS.UNKNOWN_FAIL_CLOSED,
    subreason: "TARGET_REFERENCE_COUNT_NOT_TWO",
  });
  assert.deepEqual(classifyReferenceMetadata([
    { generatedFileRole: ROLES.UNKNOWN, contractBearing: false },
    { generatedFileRole: ROLES.ROUTE_INVENTORY, contractBearing: false },
  ]), {
    classification: CLASSIFICATIONS.UNKNOWN_FAIL_CLOSED,
    subreason: "REFERENCE_ROLE_UNKNOWN",
  });
});

test("WP138 path policy is normalized, route-relative and fail-closed", () => {
  assert.equal(normalizeRelativePath("./src\\app//api/route.ts/"), "src/app/api/route.ts");
  assert.deepEqual(pathSegments("SRC\\App\\Route.ts"), ["src", "app", "route.ts"]);
  assert.equal(isForbiddenMirrorPath("src/app/api/route.ts"), false);
  assert.equal(isForbiddenMirrorPath(".next/types/validator.ts"), true);
  assert.equal(isForbiddenMirrorPath("node_modules/typescript/index.d.ts"), true);
  assert.equal(isForbiddenMirrorPath("src/.env.test"), true);
});

test("WP138 copyTree and cleanup preserve only safe generated-input candidates", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "celebratedeal-wp138-copy-"));
  const source = path.join(root, "source");
  const target = path.join(root, "target");
  try {
    await fsp.mkdir(path.join(source, "src", "app"), { recursive: true });
    await fsp.mkdir(path.join(source, ".next", "types"), { recursive: true });
    await fsp.writeFile(path.join(source, "src", "app", "route.ts"), "export const POST = () => null;", "utf8");
    await fsp.writeFile(path.join(source, ".next", "types", "validator.ts"), "generated", "utf8");
    const summary = copyTree(source, target);
    assert.equal(fs.existsSync(path.join(target, "src", "app", "route.ts")), true);
    assert.equal(fs.existsSync(path.join(target, ".next")), false);
    assert.equal(summary.copiedFiles, 1);
    assert.ok(summary.excludedNextEntries >= 1);
    assert.match(digestFile(path.join(target, "src", "app", "route.ts")), /^[0-9a-f]{64}$/);
  } finally {
    assert.equal(cleanupTemp(root), true);
  }
});
