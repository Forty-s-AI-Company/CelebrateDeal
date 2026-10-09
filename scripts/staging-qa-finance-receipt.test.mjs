import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

// Only inert synthetic injection: configuration rejects before database access.
for (const [protectedRef, phase] of [["true", "configuration"], ["false", "configuration"], ["true", "deployment-lineage"]]) {
  test(`CLI rejects safely at ${phase} with protected ref ${protectedRef}`, async () => {
    const root = await mkdtemp(join(tmpdir(), "celebratedeal-finance-receipt-"));
    const directory = join(root, "qa-finance-bootstrap");
    const file = join(directory, "completion.json");
    const expected = { schemaVersion: "celebratedeal-staging-qa-finance-bootstrap/v1",
      status: "BLOCKED_OR_FAILED", stage: phase, productionOperations: false, providerOperations: false };
    try {
      const child = spawnSync(process.execPath, ["--import", "tsx", "scripts/bootstrap-staging-qa-finance.ts"], {
        encoding: "utf8", timeout: 30000,
        env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: root, TMP: root,
          GITHUB_ACTIONS: "true", GITHUB_REF: "refs/heads/master", GITHUB_REF_PROTECTED: protectedRef,
          RUNNER_TEMP: root, TSX_DISABLE_CACHE: "1", PAYUNI_ENV: phase === "deployment-lineage" ? "sandbox" : "production",
          JOB_SECRET: "synthetic-do-not-publish", PAYUNI_QA_FINANCE_PASSWORD: "synthetic-test-password-at-least-24",
          STAGING_DATABASE_URL: "postgresql://synthetic@db.ocbugvgojrunvenozsbx.supabase.co:5432/postgres",
          CELEBRATEDEAL_SOURCE_SHA: "a".repeat(40), CELEBRATEDEAL_DEPLOYMENT_HOST: "synthetic-preview.vercel.app" },
      });
      assert.equal(child.status, 1);
      assert.deepEqual(JSON.parse(child.stdout.trim()), expected);
      assert.equal(child.stdout.includes("synthetic-do-not-publish"), false);
      if (protectedRef === "true") assert.deepEqual(JSON.parse(await readFile(file, "utf8")), expected);
      else await assert.rejects(readFile(file), { code: "ENOENT" });
    } finally {
      await unlink(file).catch(error => { if (error.code !== "ENOENT") throw error; });
      await rmdir(directory).catch(error => { if (error.code !== "ENOENT") throw error; });
      await rmdir(root);
    }
  });
}
