import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isStagingR2UploadUrl, isSyntheticPublicR2Url, runStagingR2ImageSmoke } from "./staging-r2-image-smoke.mjs";

const input = {
  CELEBRATEDEAL_SOURCE_SHA: "a".repeat(40),
  CELEBRATEDEAL_DEPLOYMENT_HOST: "celebrate-deal-staging-fixed-a25814740s-projects.vercel.app",
  GITHUB_TOKEN: "synthetic-github-token", VERCEL_TOKEN: "synthetic-vercel-token", JOB_SECRET: "synthetic-job-secret",
};
const objectPath = "/images/12345678-1234-1234-1234-123456789abc.jpg";
const account = "0".repeat(32);

test("only a signed PUT target for the fixed staging bucket is accepted", () => {
  const safe = `https://celebrate-deal-staging.${account}.r2.cloudflarestorage.com${objectPath}?X-Amz-Signature=synthetic`;
  assert.equal(isStagingR2UploadUrl(safe), true);
  assert.equal(isStagingR2UploadUrl(safe.replace("celebrate-deal-staging", "celebrate-deal-production")), false);
  assert.equal(isStagingR2UploadUrl(safe.replace("https:", "http:")), false);
  assert.equal(isStagingR2UploadUrl(safe.replace("/images/", "/private/")), false);
  assert.equal(isStagingR2UploadUrl(safe.replace(".jpg", ".png")), false);
  assert.equal(isStagingR2UploadUrl(safe.replace("?X-Amz-Signature=synthetic", "")), false);
  assert.equal(isStagingR2UploadUrl("https://attacker.test/image.png"), false);
});

test("public read must use the approved r2.dev image path", () => {
  const safe = `https://pub-synthetic.r2.dev${objectPath}`;
  assert.equal(isSyntheticPublicR2Url(safe), true);
  assert.equal(isSyntheticPublicR2Url(safe.replace("r2.dev", "example.test")), false);
  assert.equal(isSyntheticPublicR2Url(`${safe}?token=hidden`), false);
  assert.equal(isSyntheticPublicR2Url(safe.replace("/images/", "/private/")), false);
});

test("invalid or drifting binding stops before any browser or session", async () => {
  const launch = () => { throw new Error("browser must not launch"); };
  const invalid = await runStagingR2ImageSmoke({ ...input, JOB_SECRET: "" }, { playwright: { chromium: { launch } } });
  assert.equal(invalid.reason, "INVALID_BINDING");
  assert.equal(invalid.sideEffects.syntheticSessionCreated, 0);
  const drift = await runStagingR2ImageSmoke(input, {
    verifyLineage: async () => true, verifyAlias: async () => false,
    playwright: { chromium: { launch } },
  });
  assert.equal(drift.reason, "ALIAS_NOT_VERIFIED");
  assert.equal(drift.sideEffects.syntheticSessionCreated, 0);
  assert.equal(JSON.stringify(drift).includes(input.JOB_SECRET), false);
});

test("workflow binds the protected source before owner-session execution", () => {
  const workflow = readFileSync(new URL("../.github/workflows/staging-r2-image-smoke.yml", import.meta.url), "utf8");
  assert.match(workflow, /github\.ref_protected/u);
  assert.ok(workflow.indexOf("Verify exact Preview lineage before secret injection") < workflow.indexOf("Exercise one synthetic image"));
  assert.ok(workflow.indexOf("Verify fixed staging alias before owner secret injection") < workflow.indexOf("Exercise one synthetic image"));
  assert.match(workflow, /JOB_SECRET: \$\{\{ secrets\.JOB_SECRET \}\}/u);
});
