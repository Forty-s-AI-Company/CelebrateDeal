import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  ALIAS, STEPS, classifyRequest, createReceipt, finalVerdict, formatStepSummary, routeCategory, runStagingFirstSuccess,
  providerOutcome, providerSettled, sanitizeStatus, taipeiDateTimeLocal,
} from "./staging-first-success.mjs";

const origin = `https://${ALIAS}`;
const sha = "a".repeat(40);

function request(url, method = "GET", postData = null) {
  return { url: () => url, method: () => method, postData: () => postData };
}

test("owner and buyer contexts may write only the journey's own endpoints", () => {
  for (const path of ["/register", "/welcome", "/api/products/upsert", "/forms/new", "/videos/new", "/messages/templates/new", "/lives/new", "/api/live-studio/drafts", "/projects/abc123", "/api/auth/email-verification/confirm"]) {
    assert.equal(classifyRequest(request(`${origin}${path}`, "POST"), "owner"), "WRITE", path);
    assert.equal(classifyRequest(request(`${origin}${path}`, "POST"), "buyer"), "BLOCK", path);
  }
  for (const path of ["/api/form-submissions", "/api/form-submissions/verify"]) {
    assert.equal(classifyRequest(request(`${origin}${path}`, "POST"), "buyer"), "WRITE", path);
    assert.equal(classifyRequest(request(`${origin}${path}`, "POST"), "owner"), "BLOCK", path);
  }
  assert.equal(classifyRequest(request(`${origin}/api/payments/checkout`, "POST"), "buyer"), "PAYMENT");
  assert.equal(classifyRequest(request(`${origin}/checkout/abc`, "POST"), "owner"), "PAYMENT");
  assert.equal(classifyRequest(request(`${origin}/api/payments/refund`, "POST"), "owner"), "PAYMENT");
  assert.equal(classifyRequest(request(`${origin}/orders/abc/refund`, "POST"), "owner"), "REFUND");
  assert.equal(classifyRequest(request(`${origin}/api/admin/ops/first-success/invite`, "POST"), "owner"), "BLOCK");
  assert.equal(classifyRequest(request(`${origin}/settings/billing`, "POST"), "owner"), "BLOCK");
  assert.equal(classifyRequest(request(`${origin}/lives/abc/edit`, "POST"), "owner"), "BLOCK");
  assert.equal(classifyRequest(request(`${origin}/monitoring`, "POST"), "owner"), "TELEMETRY");
  assert.equal(classifyRequest(request(`${origin}/api/affiliate-attribution/direct-entry`, "POST"), "buyer"), "ATTRIBUTION_RESET");
  assert.equal(classifyRequest(request(`${origin}/api/affiliate-attribution/direct-entry`, "POST", "{}"), "buyer"), "BLOCK");
  assert.equal(classifyRequest(request(`${origin}/dashboard`), "owner"), "READ");
  assert.equal(classifyRequest(request("https://challenges.cloudflare.com/turnstile/v0/api.js"), "owner"), "EXTERNAL");
  assert.equal(classifyRequest(request(`http://${ALIAS}/register`, "POST"), "owner"), "EXTERNAL");
});

test("route evidence keeps fixed categories, never ids, slugs or queries", () => {
  assert.equal(routeCategory(`${origin}/register?invite=secret`), "REGISTER");
  assert.equal(routeCategory(`${origin}/lives/abc123/preview`), "LIVE_PREVIEW");
  assert.equal(routeCategory(`${origin}/projects/abc123?published=1`), "PROJECT");
  assert.equal(routeCategory(`${origin}/form/cdfs-form-123`), "PUBLIC_FORM");
  assert.equal(routeCategory(`${origin}/verify-registration?token=x`), "VERIFY_REGISTRATION");
  assert.equal(routeCategory(`${origin}/private/thing`), "OTHER");
  assert.equal(routeCategory("https://example.test/register"), "EXTERNAL");
  assert.equal(routeCategory("not a url"), "INVALID_URL");
});

test("status answers are reduced to fixed categories and this deployment's own link paths", () => {
  const clean = sanitizeStatus({
    ownerRegistered: true, ownerConsentRecorded: "yes", ownerEmailVerified: false,
    merchantVerificationEmail: { status: "SENT", providerEvent: "DELIVERED", to: "someone@example.test" },
    merchantVerificationLinkPath: "https://evil.example/verify-email?token=AAAAAAAAAAAAAAAAAAAA",
    buyerSubmissions: 1, buyerVerifiedSubmissions: -4,
    buyerVerificationEmail: { status: "<b>", providerEvent: "delivered", linkSource: "INBOX" },
    buyerVerificationLinkPath: "/verify-registration?token=fsv1.synthetic-token.signature",
    registrationConfirmationEmail: null,
    email: "leak@example.test",
  });
  assert.deepEqual(clean, {
    ownerRegistered: true, ownerConsentRecorded: false, ownerEmailVerified: false,
    merchantVerificationEmail: { status: "SENT", providerEvent: "DELIVERED" },
    merchantVerificationLinkPath: null,
    buyerSubmissions: 1, buyerVerifiedSubmissions: 0,
    buyerVerificationEmail: { status: "OTHER", providerEvent: "OTHER", linkSource: "NONE" },
    buyerVerificationLinkPath: "/verify-registration?token=fsv1.synthetic-token.signature",
    registrationConfirmationEmail: { status: "OTHER", providerEvent: "OTHER" },
  });
  assert.equal(sanitizeStatus({ buyerVerificationLinkPath: "/verify-registration?token=abcdefghijklmnopqrst&next=/x" }).buyerVerificationLinkPath, null);
  assert.equal(sanitizeStatus(null).ownerRegistered, false);
});

test("PASS needs every step, no blocked write, no page error and no payment attempt", () => {
  const receipt = createReceipt(sha);
  for (const entry of receipt.steps) { entry.status = "PASS"; entry.durationMs = 10; }
  assert.deepEqual(finalVerdict(receipt), { result: "PASS", reason: "NONE" });
  receipt.steps.find((entry) => entry.step === "REGISTRATION_CONFIRMATION_EMAIL").status = "NOT_VERIFIABLE";
  assert.deepEqual(finalVerdict(receipt), { result: "BLOCKED", reason: "STEP_REGISTRATION_CONFIRMATION_EMAIL_NOT_VERIFIABLE" });
  receipt.steps.find((entry) => entry.step === "REGISTRATION_CONFIRMATION_EMAIL").status = "PASS";
  receipt.blockedWrites = 1;
  assert.equal(finalVerdict(receipt).reason, "UNEXPECTED_WRITE_BLOCKED");
  receipt.blockedWrites = 0;
  receipt.pageErrors = 2;
  assert.equal(finalVerdict(receipt).reason, "PAGE_ERRORS");
  receipt.pageErrors = 0;
  receipt.sideEffects.paymentSubmissions = 1;
  assert.equal(finalVerdict(receipt).reason, "PAYMENT_ATTEMPTED");
  assert.match(formatStepSummary(receipt), /^INVITE=PASS\/10ms REGISTER=PASS\/10ms /u);
});

test("the receipt is de-identified: fixed keys, no email, name, URL or token", () => {
  const receipt = createReceipt(sha);
  assert.deepEqual(receipt.steps.map((entry) => entry.step), STEPS);
  const serialized = JSON.stringify(receipt);
  for (const forbidden of ["@", "http", "token", "invite=", "runId", "email\":\"", "name\":"]) assert.ok(!serialized.includes(forbidden), forbidden);
  assert.equal(createReceipt("not-a-sha").sourceSha, null);
});

test("provider events: only a final answer stops polling; bounces fail, unknowns are not verifiable", () => {
  for (const event of ["DELIVERED", "OPENED", "CLICKED"]) { assert.equal(providerSettled(event), true); assert.equal(providerOutcome(event), "PASS"); }
  for (const event of ["BOUNCED", "COMPLAINED", "FAILED", "CANCELED", "SUPPRESSED"]) { assert.equal(providerSettled(event), true); assert.equal(providerOutcome(event), "FAIL"); }
  // A 429 surfaces as LOOKUP_UNAVAILABLE and must keep polling instead of ending the step.
  for (const event of ["LOOKUP_UNAVAILABLE", "NOT_LOOKED_UP", "SENT", "QUEUED", "DELIVERY_DELAYED", "OTHER"]) { assert.equal(providerSettled(event), false); assert.equal(providerOutcome(event), "NOT_VERIFIABLE"); }
});

test("live schedule is entered in Taiwan time", () => {
  assert.equal(taipeiDateTimeLocal(new Date("2026-11-13T12:30:00Z")), "2026-11-13T20:30");
  assert.equal(taipeiDateTimeLocal(new Date("2026-11-13T20:00:00Z")), "2026-11-14T04:00");
});

test("invalid bindings, lineage or alias stop before any browser or ops call", async () => {
  const playwright = { chromium: { launch: async () => { throw new Error("must not launch"); } } };
  assert.equal((await runStagingFirstSuccess({}, { playwright })).reason, "INVALID_BINDING");
  const env = { CELEBRATEDEAL_SOURCE_SHA: sha, CELEBRATEDEAL_DEPLOYMENT_HOST: "celebrate-deal-staging-abc123-a25814740s-projects.vercel.app", GITHUB_TOKEN: "gh", VERCEL_TOKEN: "vc", JOB_SECRET: "j".repeat(32) };
  assert.equal((await runStagingFirstSuccess(env, { playwright, verifyLineage: async () => false, verifyAlias: async () => true })).reason, "LINEAGE_NOT_VERIFIED");
  assert.equal((await runStagingFirstSuccess(env, { playwright, verifyLineage: async () => true, verifyAlias: async () => false })).reason, "ALIAS_NOT_VERIFIED");
  const launchFailure = await runStagingFirstSuccess(env, { playwright, verifyLineage: async () => true, verifyAlias: async () => true });
  assert.equal(launchFailure.reason, "BROWSER_LAUNCH_FAILED");
  assert.ok(launchFailure.steps.every((entry) => entry.status === "NOT_RUN"));
});

test("workflow is manual, protected-master only, and never starts checkout or buyer_order", async () => {
  const workflow = await readFile(new URL("../.github/workflows/staging-first-success.yml", import.meta.url), "utf8");
  assert.match(workflow, /^on:\n {2}workflow_dispatch:/mu);
  assert.doesNotMatch(workflow, /^\s+(?:push|pull_request|schedule):/mu);
  assert.match(workflow, /if: \$\{\{ github\.ref == 'refs\/heads\/master' && github\.ref_protected \}\}/u);
  assert.match(workflow, /environment: Preview – celebrate-deal-staging/u);
  assert.doesNotMatch(workflow, /buyer_order|PAYUNI_|payment-only|wp4-buyer/u);
  // Secrets reach only the alias check and the runner step, after tests and lineage.
  assert.equal((workflow.match(/secrets\.JOB_SECRET/gu) ?? []).length, 1);
  assert.ok(workflow.indexOf("node --test scripts/staging-first-success.test.mjs") < workflow.indexOf("secrets.VERCEL_TOKEN"));
  const runner = await readFile(new URL("./staging-first-success.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(runner, /wp4-buyer|payment-attempt|\/checkout\//u);
});
