import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "vitest";

import {
  RELEASE_CRITICAL_ENVIRONMENT_KEYS,
  ReleaseReadinessError,
  environmentAvailability,
  manifestForArtifact,
  rehearseRollback,
  verifyLocalRelease,
} from "./release-local-readiness.mjs";

const roots = [];

async function fixtureRoot() {
  const root = await mkdtemp(join(tmpdir(), "celebratedeal-release-test-"));
  roots.push(root);
  await mkdir(join(root, "src", "app", "api", "health"), { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({ scripts: { build: "next build", start: "next start" } }));
  await writeFile(join(root, "next.config.ts"), "export default {};\n");
  await writeFile(join(root, "vercel.json"), JSON.stringify({ framework: "nextjs" }));
  await writeFile(join(root, "src", "app", "api", "health", "route.ts"), "export {};\n");
  return root;
}

async function artifact(root, name, content = "candidate") {
  const artifactRoot = join(root, name);
  await mkdir(join(artifactRoot, "server"), { recursive: true });
  await mkdir(join(artifactRoot, "cache"), { recursive: true });
  await writeFile(join(artifactRoot, "BUILD_ID"), `${content}-build\n`);
  await writeFile(join(artifactRoot, "required-server-files.json"), JSON.stringify({ version: 1, files: ["BUILD_ID"] }));
  await writeFile(join(artifactRoot, "server", "app-paths-manifest.json"), JSON.stringify({ "/": "app/page.js" }));
  await writeFile(join(artifactRoot, "server", "route.js"), content);
  await writeFile(join(artifactRoot, "cache", "volatile"), `${Date.now()}`);
  return artifactRoot;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("verifies a release artifact with a stable normalized checksum and value-free environment availability", async () => {
  const root = await fixtureRoot();
  const artifactRoot = await artifact(root, ".next");
  const sentinel = "release-secret-must-not-appear";
  const first = await verifyLocalRelease({ sourceRoot: root, artifactRoot, environment: { JOB_SECRET: sentinel } });
  const second = await verifyLocalRelease({ sourceRoot: root, artifactRoot, environment: { JOB_SECRET: sentinel } });

  assert.equal(first.status, "verified");
  assert.equal(first.artifact.checksum, second.artifact.checksum);
  assert.equal(first.environmentAvailability.JOB_SECRET, true);
  assert.equal(JSON.stringify(first).includes(sentinel), false);
});

test("fails closed for a missing artifact, invalid deployment config, and checksum mismatch", async () => {
  const root = await fixtureRoot();
  const artifactRoot = await artifact(root, ".next");
  await assert.rejects(
    () => manifestForArtifact(join(root, "missing")),
    (error) => error instanceof ReleaseReadinessError && error.code === "RELEASE_ARTIFACT_FILE_MISSING",
  );
  await writeFile(join(root, "vercel.json"), "not-json");
  await assert.rejects(
    () => verifyLocalRelease({ sourceRoot: root, artifactRoot }),
    (error) => error instanceof ReleaseReadinessError && error.code === "RELEASE_CONFIG_INVALID_JSON",
  );
  await writeFile(join(root, "vercel.json"), JSON.stringify({ framework: "nextjs" }));
  await assert.rejects(
    () => verifyLocalRelease({ sourceRoot: root, artifactRoot, expectedChecksum: "not-the-real-checksum" }),
    (error) => error instanceof ReleaseReadinessError && error.code === "RELEASE_ARTIFACT_CHECKSUM_MISMATCH",
  );
});

test("rolls active metadata back to the previous artifact after an injected candidate activation failure", async () => {
  const root = await fixtureRoot();
  const previousArtifactRoot = await artifact(root, "previous", "previous");
  const candidateArtifactRoot = await artifact(root, "candidate", "candidate");
  const previous = await manifestForArtifact(previousArtifactRoot);
  const result = await rehearseRollback({ previousArtifactRoot, candidateArtifactRoot });

  assert.equal(result.status, "rollback-rehearsed");
  assert.equal(result.injectedCandidateActivationFailure, true);
  assert.equal(result.previousChecksum, previous.checksum);
  assert.equal(result.recoveredChecksum, previous.checksum);
});

test("environment availability preserves only key names and booleans", () => {
  const sentinel = "release-env-secret";
  const availability = environmentAvailability({ DATABASE_URL: sentinel, NEXT_PUBLIC_APP_URL: "" });
  assert.equal(availability.DATABASE_URL, true);
  assert.equal(availability.NEXT_PUBLIC_APP_URL, false);
  assert.equal(JSON.stringify(availability).includes(sentinel), false);
});

test("reports every release-critical binding as presence-only metadata", () => {
  const requiredDeploymentKeys = [
    "CRON_SECRET",
    "LIVE_CHAT_INGRESS_SECRET",
    "PAYUNI_ENV",
    "PAYUNI_HASH_KEY",
    "PAYUNI_HASH_IV",
    "PAYUNI_MERCHANT_ID",
    "CLOUDFLARE_ACCOUNT_ID",
    "CLOUDFLARE_STREAM_TOKEN",
    "CLOUDFLARE_STREAM_WEBHOOK_SECRET",
    "UPSTASH_REDIS_REST_URL",
    "UPSTASH_REDIS_REST_TOKEN",
    "SENTRY_AUTH_TOKEN",
  ];
  for (const key of requiredDeploymentKeys) {
    assert.equal(RELEASE_CRITICAL_ENVIRONMENT_KEYS.includes(key), true, `missing inventory key: ${key}`);
  }

  const sentinel = "release-critical-synthetic-value";
  const availability = environmentAvailability(Object.fromEntries(
    RELEASE_CRITICAL_ENVIRONMENT_KEYS.map((key) => [key, sentinel]),
  ));
  assert.deepEqual(Object.keys(availability), [...RELEASE_CRITICAL_ENVIRONMENT_KEYS]);
  assert.equal(Object.values(availability).every((value) => value === true), true);
  assert.equal(JSON.stringify(availability).includes(sentinel), false);
});
