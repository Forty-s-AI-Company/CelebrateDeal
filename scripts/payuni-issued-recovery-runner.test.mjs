import test from "node:test";
import assert from "node:assert/strict";
import { runIssuedRecoveryProbe } from "./payuni-issued-recovery-runner.mjs";

const input = { sourceSha: "a".repeat(40), previewHost: "synthetic-preview.vercel.app", payuniEnv: "sandbox",
  jobSecret: "synthetic-job", cardNumber: "4147631000000001", cardExpiry: "1230", cardCvv: "123" };
function fixture({ preflight = true } = {}) {
  const calls = [];
  const dependencies = {
    queryProvider: async () => { throw new Error("should only be used by browser observer"); },
    request: async operation => {
      calls.push(operation);
      const path = new URL(operation.url).pathname;
      if (path.endsWith("/wp4-preflight")) return { status: preflight ? 200 : 404, body: { ready: preflight, buyerOrder: preflight } };
      if (path.endsWith("/wp4-fixture")) return { status: 200, body: { ready: true, createdCount: 6, reusedCount: 0 } };
      if (path.endsWith("/checkout/admission")) return { status: 200, body: {
        admissionToken: `ca1.${"a".repeat(64)}.${"b".repeat(43)}`, idempotencyKey: "11111111-1111-4111-8111-111111111111", expiresAt: "2030-01-01T00:00:00.000Z" },
      sessionCookie: "celebratedeal_checkout_session=synthetic" };
      if (path === "/api/payments/checkout") return { status: 200, body: { ok: true, provider: "payuni", orderNumber: "synthetic_order",
        transactionId: "synthetic_transaction", amountCents: 100, currency: "TWD", checkoutUrl: null,
        formAction: "https://sandbox-api.payuni.com.tw/api/upp", formMethod: "POST",
        formPayload: { MerID: "synthetic", Version: "2.0", EncryptInfo: "synthetic", HashInfo: "synthetic" },
        nextAction: "submit_payuni_upp_form", externalRequired: false }, supportCookie: "celebrate_support_synthetic=synthetic" };
      if (path.endsWith("/wp4-payment-attempt")) return { status: 200, body: { status: "SUBMIT_ALLOWED", reservationCreated: true } };
      throw new Error("unexpected path");
    },
    observeBrowser: async value => {
      assert.equal(value.prepared.canonicalStagingOrigin, true);
      assert.equal(value.prepared.invocation.payuniEnv, "sandbox");
      return { result: "ORIGINAL_PAGE_RETRY_UNAVAILABLE" };
    },
  };
  return { calls, dependencies };
}
test("source-bound Sandbox runtime rejection precedes all fixture and checkout writes", async () => {
  const f = fixture({ preflight: false });
  await assert.rejects(runIssuedRecoveryProbe(input, f.dependencies), /RUNNER_REJECTED/);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].headers["x-celebratedeal-source-sha"], input.sourceSha);
});
test("prepares one fixed canonical staging checkout without selecting another order", async () => {
  const f = fixture();
  assert.equal((await runIssuedRecoveryProbe(input, f.dependencies)).result, "ORIGINAL_PAGE_RETRY_UNAVAILABLE");
  assert.equal(f.calls.length, 5);
  for (const operation of f.calls) {
    assert.equal(new URL(operation.url).origin, "https://celebrate-deal-staging.carry-digital-nomad.in.net");
    if (operation.headers.origin) assert.equal(operation.headers.origin, "https://celebrate-deal-staging.carry-digital-nomad.in.net");
  }
  assert.equal(f.calls.filter(call => new URL(call.url).pathname === "/api/payments/checkout").length, 1);
});
test("Production input never accesses the application or provider", async () => {
  const f = fixture();
  await assert.rejects(runIssuedRecoveryProbe({ ...input, payuniEnv: "production" }, f.dependencies), /RUNNER_REJECTED/);
  assert.equal(f.calls.length, 0);
});
