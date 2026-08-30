import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, expect } from "vitest";

import {
  buildIsolatedEnvironment,
  buildRunIdentity,
  cleanupTempRoot,
  hasOnlyEphemeralDataMount,
  parseContainerInspection,
  receiptPath as canonicalReceiptPath,
  verifyReceipt,
  verifyReceiptFile,
} from "./rt01-live-chat-disposable-qa.mjs";
import { listCanonicalMigrations } from "./prisma-loopback-disposable-migration-runner.mjs";

const runId = "0123456789abcdef";

function validReceipt() {
  return {
    schemaVersion: "celebratedeal-rt01-d2-live-chat-disposable/v1",
    workPackage: "RT-01-D2",
    status: "PASS",
    runId,
    startedAt: "2026-08-17T00:00:00.000Z",
    finishedAt: "2026-08-17T00:01:00.000Z",
    migrationNames: listCanonicalMigrations(),
    phases: {
      validate: "PASS",
      deploy: "PASS",
      status: "PASS",
      migrationState: "PASS",
      liveChatDbTests: "PASS",
    },
    testResult: {
      suiteCount: 1,
      exactSuite: true,
      requiredTestPassed: true,
      tests: { total: 1, passed: 1, failed: 0, skipped: 0 },
    },
    cleanup: { container: "PASS", tempRoot: "PASS" },
    safety: {
      sourceEnvContentsRead: false,
      rawOutputPersisted: false,
      loopbackOnly: true,
      noPersistentVolume: true,
      syntheticFixturesOnly: true,
      productionSideEffects: false,
    },
    failure: { code: null },
  };
}

test("parses and validates the exact RT-01-D2 container ownership shape", () => {
  const parsed = parseContainerInspection(
    "a".repeat(64) + "\t/celebratedeal-rt01-live-chat-0123456789abcdef\tRT-01-D2\t0123456789abcdef\trt01-live-chat:0123456789abcdef\ttmpfs=/var/lib/postgresql/data\n",
  );
  expect(parsed).toEqual({
    id: "a".repeat(64),
    name: "celebratedeal-rt01-live-chat-0123456789abcdef",
    workPackage: "RT-01-D2",
    runId,
    marker: "rt01-live-chat:0123456789abcdef",
    mount: "tmpfs=/var/lib/postgresql/data",
  });
  expect(parseContainerInspection("too\tfew\tfields")).toBeNull();
  expect(hasOnlyEphemeralDataMount(parsed)).toBe(true);
  expect(hasOnlyEphemeralDataMount({ mount: "volume=/var/lib/postgresql/data" })).toBe(false);
});

test("builds a sterile child environment without inheriting arbitrary process variables", () => {
  const tempRoot = path.join(os.tmpdir(), `celebratedeal-rt01-env-${crypto.randomBytes(8).toString("hex")}`);
  const sentinel = "RT01_D2_SECRET_SENTINEL";
  const previous = process.env[sentinel];
  process.env[sentinel] = "must-not-propagate";
  try {
    const environment = buildIsolatedEnvironment(tempRoot, {
      databaseUrl: "postgresql://synthetic@127.0.0.1:54321/celebratedeal_test?schema=rt01_d2_0123456789abcdef",
      enableDatabaseTest: true,
    }) as Record<string, string | undefined>;
    expect(environment[sentinel]).toBeUndefined();
    expect(environment.RT01_D2_DISPOSABLE_DB).toBe("true");
    expect(environment.DATABASE_URL).toContain("127.0.0.1");
    expect(environment.DIRECT_URL).toBe(environment.DATABASE_URL);
    expect(environment.HOME).toBe(path.join(tempRoot, "home"));
  } finally {
    if (previous === undefined) delete process.env[sentinel];
    else process.env[sentinel] = previous;
  }
});

test("requires an exact temporary marker before removing a temporary root", () => {
  const identity = buildRunIdentity(runId);
  const tempRoot = path.join(os.tmpdir(), identity.name);
  fs.mkdirSync(tempRoot, { recursive: true });
  fs.writeFileSync(path.join(tempRoot, ".marker"), "wrong-marker", "utf8");
  expect(cleanupTempRoot(tempRoot, identity.name, identity.marker)).toBe("CLEANUP_BLOCKED");
  expect(fs.existsSync(tempRoot)).toBe(true);
  fs.writeFileSync(path.join(tempRoot, ".marker"), identity.marker, "utf8");
  expect(cleanupTempRoot(tempRoot, identity.name, identity.marker)).toBe("PASS");
  expect(fs.existsSync(tempRoot)).toBe(false);
});

test("accepts only a complete sanitized PASS receipt", () => {
  const receipt = validReceipt();
  expect(verifyReceipt(receipt)).toBe(true);
  expect(verifyReceipt({ ...receipt, databaseUrl: "forbidden" })).toBe(false);
  expect(verifyReceipt({ ...receipt, port: 54321 })).toBe(false);
  expect(verifyReceipt({ ...receipt, stdout: "raw output" })).toBe(false);
  expect(verifyReceipt({ ...receipt, safety: { ...receipt.safety, noPersistentVolume: false } })).toBe(false);
  expect(verifyReceipt({ ...receipt, cleanup: { ...receipt.cleanup, container: "CLEANUP_BLOCKED" } })).toBe(false);
  expect(verifyReceipt("not-json")).toBe(false);
});

test("verifies the receipt sidecar digest without reading arbitrary filenames", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "celebratedeal-rt01-receipt-"));
  const serialized = `${JSON.stringify(validReceipt(), null, 2)}\n`;
  const digest = crypto.createHash("sha256").update(serialized, "utf8").digest("hex");
  const copiedReceiptPath = path.join(tempRoot, "rt01-live-chat-disposable-receipt.json");
  const copiedDigestPath = `${copiedReceiptPath}.sha256`;
  const canonicalDigestPath = `${canonicalReceiptPath}.sha256`;
  const previousReceipt = fs.existsSync(canonicalReceiptPath)
    ? fs.readFileSync(canonicalReceiptPath)
    : null;
  const previousDigest = fs.existsSync(canonicalDigestPath)
    ? fs.readFileSync(canonicalDigestPath)
    : null;
  fs.mkdirSync(path.dirname(canonicalReceiptPath), { recursive: true });
  fs.writeFileSync(canonicalReceiptPath, serialized, "utf8");
  fs.writeFileSync(canonicalDigestPath, `${digest}  rt01-live-chat-disposable-receipt.json\n`, "utf8");
  fs.writeFileSync(copiedReceiptPath, serialized, "utf8");
  fs.writeFileSync(copiedDigestPath, `${digest}  rt01-live-chat-disposable-receipt.json\n`, "utf8");
  try {
    expect(verifyReceiptFile(canonicalReceiptPath)).toBe(true);
    expect(verifyReceiptFile(copiedReceiptPath)).toBe(false);
    expect(verifyReceiptFile(copiedDigestPath)).toBe(false);
    fs.writeFileSync(canonicalDigestPath, `${"0".repeat(64)}  rt01-live-chat-disposable-receipt.json\n`, "utf8");
    expect(verifyReceiptFile(canonicalReceiptPath)).toBe(false);
  } finally {
    if (previousReceipt) fs.writeFileSync(canonicalReceiptPath, previousReceipt);
    else fs.rmSync(canonicalReceiptPath, { force: true });
    if (previousDigest) fs.writeFileSync(canonicalDigestPath, previousDigest);
    else fs.rmSync(canonicalDigestPath, { force: true });
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("source contract keeps database execution loopback-only and ephemeral", () => {
  const source = fs.readFileSync(new URL("./rt01-live-chat-disposable-qa.mjs", import.meta.url), "utf8");
  expect(source).toContain('"postgres:16-alpine"');
  expect(source).toContain('"--tmpfs"');
  expect(source).toContain('"/var/lib/postgresql/data"');
  expect(source).toContain('"127.0.0.1::5432"');
  expect(source).toContain('process.argv[2] === "--verify-receipt"');
  expect(source).not.toMatch(/dotenv|loadEnv/u);
});
