import { describe, expect, it } from "vitest";
import {
  PRODUCTION_APPROVAL,
  SensitiveDataReencryptRefusedError,
  parseReencryptArguments,
  resolveReencryptTarget,
  runSensitiveDataReencryption,
  type RawDb,
} from "./reencrypt-sensitive-data";

const LOOPBACK = "postgresql://postgres:postgres@localhost:54329/celebratedeal_test?schema=public"; // secret-scan: allow-test-fixture
const REMOTE = "postgresql://user:pass@db.example.test:5432/app"; // secret-scan: allow-test-fixture

function refusal(action: () => unknown) {
  try {
    action();
  } catch (error) {
    if (error instanceof SensitiveDataReencryptRefusedError) return error.category;
    throw error;
  }
  return null;
}

describe("scripts/reencrypt-sensitive-data arguments", () => {
  it("defaults to a read-only dry run over every target", () => {
    expect(parseReencryptArguments([])).toEqual({ apply: false, target: null, batchSize: 200, allowUnreadable: false, only: null });
  });

  it("parses apply, target, batch size, allow-unreadable and repeated --only", () => {
    expect(parseReencryptArguments([
      "--apply", "--target=staging", "--batch-size", "50", "--allow-unreadable",
      "--only=CommerceOrder.buyerEncryptedEnvelope", "--only=UserMfaFactor.secretEncrypted",
    ])).toEqual({
      apply: true, target: "staging", batchSize: 50, allowUnreadable: true,
      only: ["CommerceOrder.buyerEncryptedEnvelope", "UserMfaFactor.secretEncrypted"],
    });
  });

  it.each([
    [["--target=prod"], "invalid-target"],
    [["--batch-size", "0"], "invalid-batch-size"],
    [["--batch-size", "1001"], "invalid-batch-size"],
    [["--only=User.passwordHash"], "unknown-only"],
    [["--execute"], "unknown-argument"],
  ])("refuses %j", (argv, category) => {
    expect(refusal(() => parseReencryptArguments(argv))).toBe(category);
  });
});

describe("scripts/reencrypt-sensitive-data database guard", () => {
  it("allows a loopback celebratedeal_* database without a target", () => {
    expect(resolveReencryptTarget({ DATABASE_URL: LOOPBACK }, null)).toEqual({ url: LOOPBACK, target: "loopback" });
    expect(refusal(() => resolveReencryptTarget({ DATABASE_URL: LOOPBACK }, "production"))).toBe("target-mismatch");
  });

  it("refuses a missing URL, an unnamed remote, a non-staging staging target and unapproved production", () => {
    expect(refusal(() => resolveReencryptTarget({}, null))).toBe("missing");
    expect(refusal(() => resolveReencryptTarget({ DATABASE_URL: REMOTE }, null))).toBe("remote-without-target");
    expect(refusal(() => resolveReencryptTarget({ DATABASE_URL: REMOTE }, "staging"))).toBe("not-staging");
    expect(refusal(() => resolveReencryptTarget({ DATABASE_URL: REMOTE }, "production"))).toBe("production-not-approved");
    expect(resolveReencryptTarget({ DATABASE_URL: REMOTE, DATA_REENCRYPT_PRODUCTION_APPROVAL: PRODUCTION_APPROVAL }, "production"))
      .toEqual({ url: REMOTE, target: "production" });
  });

  it("refuses to start with a malformed keyring before touching the database", async () => {
    const previous = process.env.DATA_ENCRYPTION_KEYRING;
    process.env.DATA_ENCRYPTION_KEYRING = "[]";
    const db = { $queryRawUnsafe: () => { throw new Error("must not query"); }, $executeRawUnsafe: () => { throw new Error("must not write"); } } as unknown as RawDb;
    try {
      await expect(runSensitiveDataReencryption(db, parseReencryptArguments([]), {})).rejects.toMatchObject({ category: "keyring-empty" });
    } finally {
      if (previous === undefined) delete process.env.DATA_ENCRYPTION_KEYRING;
      else process.env.DATA_ENCRYPTION_KEYRING = previous;
    }
  });
});
