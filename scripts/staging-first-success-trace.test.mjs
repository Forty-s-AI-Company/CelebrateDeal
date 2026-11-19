import assert from "node:assert/strict";
import test from "node:test";
import { createActionTrace, formatTraceLine, sanitizeTarget, sanitizeUrl } from "./staging-first-success-trace.mjs";

const alias = "https://celebrate-deal-staging.carry-digital-nomad.in.net";

function fakeLocator(description, behaviour) {
  return {
    toString: () => description,
    first() { return this; },
    async click() { await behaviour.click?.(); },
    async fill() {},
    async waitFor() { await behaviour.waitFor?.(); },
    async isEnabled() { return true; },
  };
}

function fakePage(state, behaviour = {}) {
  return {
    url: () => state.url,
    on() { return "bound"; },
    getByRole(role, options) { return fakeLocator(`getByRole('${role}', { name: '${options.name}', exact: true })`, behaviour); },
    locator(selector) { return fakeLocator(`locator('${selector}')`, behaviour); },
    async goto(url) { state.advance(1_000); if (behaviour.goto) await behaviour.goto(url); },
    async waitForURL() { state.advance(45_000); throw Object.assign(new Error("page.waitForURL: Timeout 45000ms exceeded."), { name: "TimeoutError" }); },
  };
}

test("a timed-out action records step, action, target, duration, error kind and the sanitized current page", async () => {
  const state = { url: `${alias}/forms/new?token=SECRETSECRETSECRETSECRET`, clock: 0, advance(ms) { this.clock += ms; } };
  const trace = createActionTrace({ now: () => state.clock });
  trace.setStep("FORM");
  const page = trace.instrumentPage(fakePage(state, {
    click: async () => { state.advance(10_000); throw Object.assign(new Error("locator.click: Timeout 10000ms exceeded."), { name: "TimeoutError" }); },
  }));

  await page.goto(`${alias}/forms/new?invite=abcdefghijklmnopqrstuvwxyz0123`);
  await assert.rejects(page.getByRole("button", { name: "儲存表單" }).click({ timeout: 10_000 }), { name: "TimeoutError" });

  const summary = trace.summary({ result: "BLOCKED", failureStep: "FORM", failureCategory: "TIMEOUT" });
  assert.equal(summary.schemaVersion, "celebratedeal-staging-first-success-trace/v1");
  assert.equal(summary.actions, 2);
  assert.equal(summary.failures.length, 1);
  assert.deepEqual(summary.failedAction, {
    step: "FORM", action: "click", target: "getByRole('button', { name: '儲存表單', exact: true })",
    durationMs: 10_000, outcome: "FAIL", pageUrl: "/forms/new?<query>", errorKind: "TIMEOUT",
  });
  assert.deepEqual(summary.recentActions.map((entry) => [entry.action, entry.outcome, entry.durationMs]), [["goto", "OK", 1_000], ["click", "FAIL", 10_000]]);
  assert.equal(summary.recentActions[0].target, "/forms/new?<query>");
  assert.equal(
    formatTraceLine(summary),
    'staging_first_success_failed_action=FORM/click/TIMEOUT/10000ms target="getByRole(\'button\', { name: \'儲存表單\', exact: true })" page="/forms/new?<query>"',
  );
});

test("waitForURL timeouts keep the real duration without the predicate text", async () => {
  const state = { url: `${alias}/forms/new`, clock: 100, advance(ms) { this.clock += ms; } };
  const trace = createActionTrace({ now: () => state.clock });
  trace.setStep("FORM");
  const page = trace.instrumentPage(fakePage(state));
  await assert.rejects(page.waitForURL(() => false, { timeout: 45_000 }));
  const [failure] = trace.summary({ failureStep: "FORM" }).failures;
  assert.equal(failure.action, "waitForURL");
  assert.equal(failure.target, "<url-predicate>");
  assert.equal(failure.durationMs, 45_000);
  assert.equal(failure.errorKind, "TIMEOUT");
});

test("output never contains emails, tokens, ids, slugs, queries or fill values", async () => {
  const state = { url: `${alias}/verify-email?token=fsv1.synthetic-token.signature`, clock: 0, advance(ms) { this.clock += ms; } };
  const trace = createActionTrace({ now: () => state.clock });
  trace.setStep("REGISTER");
  const page = trace.instrumentPage(fakePage(state, { click: async () => { throw new Error("boom delivered+cdfs-buyer-0123456789abcdef01234567@resend.dev"); } }));
  await assert.rejects(page.locator('input[name="email"]').fill("delivered+secret@resend.dev").then(() => page.locator("a[href*='CDFS 1a2b3c4d']").first().click()));
  await assert.rejects(page.goto(`${alias}/form/cdfs-form-1a2b3c4d5e?liveId=clx0123456789abcdefghij`).then(() => { throw new Error("x@y.test"); }));
  const serialized = JSON.stringify(trace.summary({ failureStep: "REGISTER" }));
  for (const forbidden of ["@", "secret", "token=", "fsv1", "1a2b3c4d5e", "clx0123456789", "liveId", "0123456789abcdef"]) {
    assert.ok(!serialized.includes(forbidden), forbidden);
  }
  assert.match(serialized, /CDFS <run>/u);
  assert.equal(sanitizeUrl(`${alias}/form/cdfs-form-1a2b3c4d5e?liveId=x`), "/form/:slug?<query>");
  assert.equal(sanitizeUrl(`${alias}/lives/cm1234567890abcdefgh/preview`), "/lives/:id/preview");
  assert.equal(sanitizeTarget("a b@c.test  d"), "a <email> d");
});

test("recording is transparent: results and non-action members pass through, and the ring and failure list are bounded", async () => {
  const state = { url: `${alias}/dashboard`, clock: 0, advance(ms) { this.clock += ms; } };
  const trace = createActionTrace({ now: () => state.clock });
  trace.setStep("PRODUCT");
  const page = trace.instrumentPage(fakePage(state));
  assert.equal(page.on("x"), "bound");
  assert.equal(await page.locator("input").first().isEnabled(), true);
  for (let index = 0; index < 40; index += 1) await page.waitForURL(() => false).catch(() => {});
  const summary = trace.summary({ failureStep: "PRODUCT" });
  assert.equal(summary.failures.length, 30);
  assert.equal(summary.droppedFailures, 10);
  assert.equal(summary.recentActions.length, 8);
  assert.equal(summary.actions, 41);
  assert.equal(formatTraceLine(createActionTrace().summary({ failureStep: "NONE" })), "staging_first_success_failed_action=NONE failures=0 actions=0");
});
