import { createHash, createHmac } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { PaymentTransaction } from "@prisma/client";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getPaymentProvider } from "@/lib/payment-providers";
import { buildPayUniSandboxWebhookFixture } from "@/lib/payment-providers/payuni-fixtures";
import { PaymentProviderNotAllowedError } from "@/lib/payment-providers/runtime-policy";
import {
  PaymentQueryProviderError,
  RefundProviderError,
  type CheckoutProviderReadiness,
  type PaymentProviderAdapter,
} from "@/lib/payment-providers/types";
import { PaymentWebhookPayload } from "@/lib/payment-webhooks";

/**
 * F-008 adapter contract: every adapter registered with `getPaymentProvider`
 * must satisfy the same rules. Adding an adapter to the registry without a
 * fixture here fails the suite, so a new provider cannot skip the contract.
 * No test reaches the network: `fetch` is replaced before every test.
 */

type Env = Record<string, string | undefined>;

const CHECKOUT_READINESS_VALUES: readonly CheckoutProviderReadiness[] = ["ready", "local_only", "unavailable"];

/** Every variable an adapter reads; each scenario starts from all of them unset. */
const CONTRACT_ENV_KEYS = [
  "PAYUNI_ENV",
  "PAYUNI_MERCHANT_ID",
  "PAYUNI_HASH_KEY",
  "PAYUNI_HASH_IV",
  "PAYUNI_SANDBOX_MERCHANT_ID",
  "PAYUNI_SANDBOX_HASH_KEY",
  "PAYUNI_SANDBOX_HASH_IV",
  "VERCEL_ENV",
  "WP4_SANDBOX_EXECUTOR_ENABLED",
  "ECPAY_WEBHOOK_SECRET",
] as const;

// Synthetic, distinctive values so a leak into a return value is detectable.
const PAYUNI_MERCHANT_ID = "CONTRACTMER01";
const PAYUNI_HASH_KEY = "ContractHashKey-0123456789abcdef"; // 32 bytes
const PAYUNI_HASH_IV = "ContractIv-01234"; // 16 bytes
const ECPAY_SECRET = "contract-ecpay-webhook-secret-value";

const payUniSandboxEnv: Env = {
  PAYUNI_ENV: "sandbox",
  PAYUNI_SANDBOX_MERCHANT_ID: PAYUNI_MERCHANT_ID,
  PAYUNI_SANDBOX_HASH_KEY: PAYUNI_HASH_KEY,
  PAYUNI_SANDBOX_HASH_IV: PAYUNI_HASH_IV,
};

const payUniProductionEnv: Env = {
  PAYUNI_ENV: "production",
  PAYUNI_MERCHANT_ID: PAYUNI_MERCHANT_ID,
  PAYUNI_HASH_KEY: PAYUNI_HASH_KEY,
  PAYUNI_HASH_IV: PAYUNI_HASH_IV,
};

/** Configuration states the readiness rule is checked under, including broken ones. */
const READINESS_SCENARIOS: Record<string, Env> = {
  "nothing configured": {},
  "PayUni Sandbox configured": { ...payUniSandboxEnv, ECPAY_WEBHOOK_SECRET: ECPAY_SECRET },
  "PayUni production configured": { ...payUniProductionEnv, ECPAY_WEBHOOK_SECRET: ECPAY_SECRET },
  "live merchant on a Preview deployment": { ...payUniProductionEnv, VERCEL_ENV: "preview" },
  "unknown PAYUNI_ENV": { ...payUniSandboxEnv, PAYUNI_ENV: "bogus-environment-value" },
  "credentials with invalid lengths": {
    PAYUNI_ENV: "sandbox",
    PAYUNI_SANDBOX_MERCHANT_ID: PAYUNI_MERCHANT_ID,
    PAYUNI_SANDBOX_HASH_KEY: "short-contract-key",
    PAYUNI_SANDBOX_HASH_IV: "short-iv",
  },
};

function applyEnv(env: Env) {
  for (const key of CONTRACT_ENV_KEYS) vi.stubEnv(key, undefined);
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
}

const networkDisabled = () => Promise.reject(new Error("Network access is disabled in adapter contract tests."));

beforeEach(() => {
  applyEnv({});
  vi.stubGlobal("fetch", vi.fn(networkDisabled));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/** Reads the registry keys from the source so a new registration cannot bypass this suite. */
function registeredProviderIds() {
  const indexPath = path.join(process.cwd(), "src", "lib", "payment-providers", "index.ts");
  const source = ts.createSourceFile(indexPath, fs.readFileSync(indexPath, "utf8"), ts.ScriptTarget.Latest, true);
  const ids: string[] = [];
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== "providers") continue;
      if (!declaration.initializer || !ts.isObjectLiteralExpression(declaration.initializer)) continue;
      for (const property of declaration.initializer.properties) {
        if (property.name && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) {
          ids.push(property.name.text);
        }
      }
    }
  }
  return ids;
}

type WebhookCase = { name: string; env: Env; rawBody: string };
type SignatureCase = { name: string; env: Env; request: Request; rawBody: string };
type ProviderErrorCase = {
  name: string;
  env: Env;
  transaction: PaymentTransaction;
  refundAmountCents?: number;
  fetch?: () => Promise<Response>;
  expectedCategory: string;
  /** False when the adapter must refuse before any provider request. */
  reachesNetwork: boolean;
};

type AdapterContractFixture = {
  /** Valid provider callbacks; each normalized payload must satisfy the shared schema. */
  webhooks: WebhookCase[];
  signature:
    | { kind: "signed"; valid: SignatureCase; tampered: SignatureCase[] }
    /** Accepts every callback; allowed only for a local-only adapter that production refuses. */
    | { kind: "unsigned_local_only" };
  refundPaymentErrors?: ProviderErrorCase[];
  queryPaymentErrors?: ProviderErrorCase[];
  /** The only endpoints the provider calls may target (checked against the mocked fetch). */
  providerEndpoint?: RegExp;
};

/** Adapters exempt from signature verification. Keep this list closed. */
const UNSIGNED_LOCAL_ONLY_ADAPTERS = new Set(["demo"]);

function callbackRequest(headers: Record<string, string> = {}) {
  return new Request("http://127.0.0.1/api/webhooks/payments", { method: "POST", headers });
}

// --- demo -------------------------------------------------------------------

const demoFixture: AdapterContractFixture = {
  webhooks: [
    {
      name: "paid",
      env: {},
      rawBody: JSON.stringify({ eventId: "demo-contract-paid", eventType: "paid", orderNumber: "CD-DEMO-CONTRACT", grossAmountCents: 99000 }),
    },
    {
      name: "refunded",
      env: {},
      rawBody: JSON.stringify({ eventId: "demo-contract-refund", eventType: "refunded", orderNumber: "CD-DEMO-CONTRACT", refundAmountCents: 99000 }),
    },
  ],
  signature: { kind: "unsigned_local_only" },
};

// --- ecpay-like ---------------------------------------------------------------

const ecpayPaidBody = JSON.stringify({
  EventId: "ecpay-contract-paid",
  EventType: "paid",
  MerchantTradeNo: "CD-ECPAY-CONTRACT",
  TradeNo: "ECPAY-CONTRACT-TRADE",
  TradeAmt: "1990",
  GatewayFee: "35",
  OccurredAt: "2026-11-18T00:00:00.000Z",
});

function ecpaySignature(rawBody: string, secret = ECPAY_SECRET) {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

function flipLastHexCharacter(value: string) {
  return `${value.slice(0, -1)}${value.endsWith("0") ? "1" : "0"}`;
}

const ecpayEnv: Env = { ECPAY_WEBHOOK_SECRET: ECPAY_SECRET };

const ecpayLikeFixture: AdapterContractFixture = {
  webhooks: [
    { name: "paid", env: ecpayEnv, rawBody: ecpayPaidBody },
    {
      name: "partial refund",
      env: ecpayEnv,
      rawBody: JSON.stringify({
        EventId: "ecpay-contract-partial",
        RtnCode: "partial refund",
        MerchantTradeNo: "CD-ECPAY-CONTRACT",
        TradeNo: "ECPAY-CONTRACT-TRADE",
        TradeAmt: "1990",
        RefundAmount: "500",
      }),
    },
  ],
  signature: {
    kind: "signed",
    valid: {
      name: "valid HMAC",
      env: ecpayEnv,
      request: callbackRequest({ "x-ecpay-signature": ecpaySignature(ecpayPaidBody) }),
      rawBody: ecpayPaidBody,
    },
    tampered: [
      {
        name: "signature with one character changed",
        env: ecpayEnv,
        request: callbackRequest({ "x-ecpay-signature": flipLastHexCharacter(ecpaySignature(ecpayPaidBody)) }),
        rawBody: ecpayPaidBody,
      },
      {
        name: "body changed after signing",
        env: ecpayEnv,
        request: callbackRequest({ "x-ecpay-signature": ecpaySignature(ecpayPaidBody) }),
        rawBody: ecpayPaidBody.replace("1990", "1"),
      },
      {
        name: "signed with another secret",
        env: ecpayEnv,
        request: callbackRequest({ "x-ecpay-signature": ecpaySignature(ecpayPaidBody, "attacker-chosen-secret") }),
        rawBody: ecpayPaidBody,
      },
      {
        name: "signature header missing",
        env: ecpayEnv,
        request: callbackRequest(),
        rawBody: ecpayPaidBody,
      },
      {
        name: "verifier secret not configured",
        env: {},
        request: callbackRequest({ "x-ecpay-signature": ecpaySignature(ecpayPaidBody) }),
        rawBody: ecpayPaidBody,
      },
    ],
  },
};

// --- payuni -------------------------------------------------------------------

function payUniBody(fixture: "paid" | "refunded", hashKey = PAYUNI_HASH_KEY, hashIv = PAYUNI_HASH_IV) {
  return buildPayUniSandboxWebhookFixture({ fixture, merchantId: PAYUNI_MERCHANT_ID, hashKey, hashIv });
}

function withField(rawBody: string, field: string, transform: (value: string) => string) {
  const params = new URLSearchParams(rawBody);
  params.set(field, transform(params.get(field) ?? ""));
  return params.toString();
}

function payUniHashInfo(encryptInfo: string) {
  return createHash("sha256").update(`${PAYUNI_HASH_KEY}${encryptInfo}${PAYUNI_HASH_IV}`).digest("hex").toUpperCase();
}

const payUniPaidBody = payUniBody("paid");

const payUniTransaction = {
  id: "tx-contract-payuni",
  vendorId: "vendor-contract",
  providerName: "payuni",
  orderNumber: "CD-CONTRACT-001",
  providerTradeNo: "PAYUNI-CONTRACT-TRADE",
  grossAmountCents: 199_000,
  currency: "TWD",
  status: "paid",
} as PaymentTransaction;

const providerHttpError = () => Promise.resolve(new Response("upstream error", { status: 502 }));
const unsignedProviderResponse = () => Promise.resolve(new Response(JSON.stringify({ Status: "SUCCESS" })));
const forgedHashProviderResponse = () => Promise.resolve(new Response(new URLSearchParams({
  Status: "SUCCESS",
  EncryptInfo: "00",
  HashInfo: flipLastHexCharacter(payUniHashInfo("00")),
}).toString()));

const payUniFixture: AdapterContractFixture = {
  providerEndpoint: /^https:\/\/(?:sandbox-)?api\.payuni\.com\.tw\/api\//,
  webhooks: [
    { name: "UPP paid", env: payUniSandboxEnv, rawBody: payUniPaidBody },
    { name: "refund notice", env: payUniSandboxEnv, rawBody: payUniBody("refunded") },
  ],
  signature: {
    kind: "signed",
    valid: { name: "valid HashInfo", env: payUniSandboxEnv, request: callbackRequest(), rawBody: payUniPaidBody },
    tampered: [
      {
        name: "HashInfo with one character changed",
        env: payUniSandboxEnv,
        request: callbackRequest(),
        rawBody: withField(payUniPaidBody, "HashInfo", (value) => flipLastHexCharacter(value)),
      },
      {
        name: "EncryptInfo changed after signing",
        env: payUniSandboxEnv,
        request: callbackRequest(),
        rawBody: withField(payUniPaidBody, "EncryptInfo", (value) => flipLastHexCharacter(value)),
      },
      {
        name: "outer merchant ID replaced",
        env: payUniSandboxEnv,
        request: callbackRequest(),
        rawBody: withField(payUniPaidBody, "MerID", () => "OTHERMERCHANT"),
      },
      {
        name: "signed with another merchant key",
        env: payUniSandboxEnv,
        request: callbackRequest(),
        rawBody: payUniBody("paid", "AttackerHashKey-0123456789abcdef", "AttackerIv-01234"),
      },
      {
        name: "verifier credentials not configured",
        env: {},
        request: callbackRequest(),
        rawBody: payUniPaidBody,
      },
    ],
  },
  refundPaymentErrors: [
    {
      name: "missing provider trade number",
      env: payUniSandboxEnv,
      transaction: { ...payUniTransaction, providerTradeNo: null },
      expectedCategory: "request_contract",
      reachesNetwork: false,
    },
    {
      name: "currency other than TWD",
      env: payUniSandboxEnv,
      transaction: { ...payUniTransaction, currency: "USD" },
      expectedCategory: "request_contract",
      reachesNetwork: false,
    },
    {
      name: "live merchant on a Preview deployment",
      env: { ...payUniProductionEnv, VERCEL_ENV: "preview" },
      transaction: payUniTransaction,
      expectedCategory: "request_contract",
      reachesNetwork: false,
    },
    {
      name: "credentials not configured",
      env: {},
      transaction: payUniTransaction,
      expectedCategory: "authentication",
      reachesNetwork: false,
    },
    {
      name: "network failure",
      env: payUniSandboxEnv,
      transaction: payUniTransaction,
      fetch: networkDisabled,
      expectedCategory: "network",
      reachesNetwork: true,
    },
    {
      name: "provider HTTP error",
      env: payUniSandboxEnv,
      transaction: payUniTransaction,
      fetch: providerHttpError,
      expectedCategory: "provider_response",
      reachesNetwork: true,
    },
    {
      name: "unsigned provider response",
      env: payUniSandboxEnv,
      transaction: payUniTransaction,
      fetch: unsignedProviderResponse,
      expectedCategory: "authentication",
      reachesNetwork: true,
    },
    {
      name: "provider response with a forged HashInfo",
      env: payUniSandboxEnv,
      transaction: payUniTransaction,
      fetch: forgedHashProviderResponse,
      expectedCategory: "authentication",
      reachesNetwork: true,
    },
  ],
  queryPaymentErrors: [
    {
      name: "PAYUNI_ENV not configured",
      env: {},
      transaction: payUniTransaction,
      expectedCategory: "request_contract",
      reachesNetwork: false,
    },
    {
      name: "transaction owned by another provider",
      env: payUniSandboxEnv,
      transaction: { ...payUniTransaction, providerName: "demo" },
      expectedCategory: "request_contract",
      reachesNetwork: false,
    },
    {
      name: "missing provider trade number",
      env: payUniSandboxEnv,
      transaction: { ...payUniTransaction, providerTradeNo: null },
      expectedCategory: "request_contract",
      reachesNetwork: false,
    },
    {
      name: "network failure",
      env: payUniSandboxEnv,
      transaction: payUniTransaction,
      fetch: networkDisabled,
      expectedCategory: "network",
      reachesNetwork: true,
    },
    {
      name: "provider HTTP error",
      env: payUniSandboxEnv,
      transaction: payUniTransaction,
      fetch: providerHttpError,
      expectedCategory: "provider_response",
      reachesNetwork: true,
    },
    {
      name: "unsigned provider response",
      env: payUniSandboxEnv,
      transaction: payUniTransaction,
      fetch: unsignedProviderResponse,
      expectedCategory: "authentication",
      reachesNetwork: true,
    },
    {
      name: "provider response with a forged HashInfo",
      env: payUniSandboxEnv,
      transaction: payUniTransaction,
      fetch: forgedHashProviderResponse,
      expectedCategory: "authentication",
      reachesNetwork: true,
    },
  ],
};

/** Keyed by `adapter.id`; aliases in the registry share their adapter's fixture. */
const CONTRACT_FIXTURES: Record<string, AdapterContractFixture> = {
  demo: demoFixture,
  "ecpay-like": ecpayLikeFixture,
  payuni: payUniFixture,
};

/** Optional provider calls, the error class each one declares, and its fixture cases. */
const OPTIONAL_PROVIDER_CALLS = [
  {
    method: "refundPayment",
    errorClass: RefundProviderError,
    cases: (fixture: AdapterContractFixture) => fixture.refundPaymentErrors,
    invoke: (adapter: PaymentProviderAdapter, errorCase: ProviderErrorCase) => adapter.refundPayment!({
      transaction: errorCase.transaction,
      refundAmountCents: errorCase.refundAmountCents ?? errorCase.transaction.grossAmountCents,
      requestId: "contract-refund-request",
    }),
  },
  {
    method: "queryPayment",
    errorClass: PaymentQueryProviderError,
    cases: (fixture: AdapterContractFixture) => fixture.queryPaymentErrors,
    invoke: (adapter: PaymentProviderAdapter, errorCase: ProviderErrorCase) => adapter.queryPayment!({
      transaction: errorCase.transaction,
    }),
  },
] as const;

const registeredIds = registeredProviderIds();

describe("payment adapter registry", () => {
  it("registers PayUni and resolves every registered ID outside production", () => {
    expect(registeredIds).toContain("payuni");
    for (const id of registeredIds) {
      expect(getPaymentProvider(id, {}).id, id).toBeTruthy();
    }
  });

  it("has a contract fixture for every registered adapter", () => {
    const adapterIds = new Set(registeredIds.map((id) => getPaymentProvider(id, {}).id));
    expect([...adapterIds].filter((adapterId) => !CONTRACT_FIXTURES[adapterId])).toEqual([]);
  });
});

describe.each(registeredIds)("payment adapter contract: %s", (registeredId) => {
  const adapter = getPaymentProvider(registeredId, {});
  const fixture = CONTRACT_FIXTURES[adapter.id]!;

  it("normalizes every valid callback into a payload the shared schema accepts", async () => {
    expect(fixture.webhooks.length).toBeGreaterThan(0);
    for (const webhook of fixture.webhooks) {
      applyEnv(webhook.env);
      const { payload } = await adapter.normalizePayload(webhook.rawBody);
      const parsed = PaymentWebhookPayload.safeParse(payload);
      expect(parsed.success, `${webhook.name}: ${parsed.error?.message ?? ""}`).toBe(true);
      // Normalization already applied the schema; parsing again changes nothing.
      expect(parsed.data, webhook.name).toEqual(payload);
      expect(payload.provider, webhook.name).toBe(adapter.id);
    }
  });

  it("returns false from verifySignature when the signature is tampered with", async () => {
    if (fixture.signature.kind === "unsigned_local_only") {
      // An unsigned adapter must be local-only and refused by a production runtime.
      expect(UNSIGNED_LOCAL_ONLY_ADAPTERS.has(adapter.id)).toBe(true);
      for (const env of Object.values(READINESS_SCENARIOS)) {
        applyEnv(env);
        expect(adapter.checkoutReadiness()).toBe("local_only");
      }
      expect(() => getPaymentProvider(registeredId, { VERCEL_ENV: "production" })).toThrow(PaymentProviderNotAllowedError);
      expect(() => getPaymentProvider(registeredId, { NODE_ENV: "production", NEXT_PUBLIC_APP_URL: "https://celebratedeal.example" }))
        .toThrow(PaymentProviderNotAllowedError);
      return;
    }

    const { valid, tampered } = fixture.signature;
    applyEnv(valid.env);
    // The untampered callback passes, so each rejection below is caused by the tampering.
    await expect(adapter.verifySignature(valid.request, valid.rawBody)).resolves.toBe(true);
    expect(tampered.length).toBeGreaterThan(0);
    for (const tamperedCase of tampered) {
      applyEnv(tamperedCase.env);
      await expect(adapter.verifySignature(tamperedCase.request, tamperedCase.rawBody), tamperedCase.name).resolves.toBe(false);
    }
  });

  it.each(Object.entries(READINESS_SCENARIOS))(
    "returns only a readiness enum value without configuration values (%s)",
    (_scenario, env) => {
      applyEnv(env);
      const readiness: unknown = adapter.checkoutReadiness();
      expect(typeof readiness).toBe("string");
      expect(CHECKOUT_READINESS_VALUES).toContain(readiness);
      const serialized = JSON.stringify(readiness);
      for (const value of Object.values(env)) {
        if (value) expect(serialized).not.toContain(value);
      }
    },
  );

  for (const call of OPTIONAL_PROVIDER_CALLS) {
    it(`${call.method}: throws its declared error class in every error case without real network access`, async () => {
      const cases = call.cases(fixture);
      if (typeof adapter[call.method] !== "function") {
        // Fixtures must not claim coverage for a method the adapter does not offer.
        expect(cases ?? []).toEqual([]);
        return;
      }
      expect(cases?.length ?? 0, `${adapter.id} implements ${call.method} but has no error fixtures`).toBeGreaterThan(0);

      for (const errorCase of cases ?? []) {
        applyEnv(errorCase.env);
        const fetchMock = vi.fn<typeof fetch>(errorCase.fetch ?? networkDisabled);
        vi.stubGlobal("fetch", fetchMock);

        const outcome = await call.invoke(adapter, errorCase).then(
          () => ({ rejected: false as const }),
          (error: unknown) => ({ rejected: true as const, error }),
        );
        expect(outcome.rejected, errorCase.name).toBe(true);
        if (!outcome.rejected) continue;
        expect(outcome.error, errorCase.name).toBeInstanceOf(call.errorClass);
        expect((outcome.error as { category: string }).category, errorCase.name).toBe(errorCase.expectedCategory);

        // Calls that must fail before contacting the provider never reach fetch;
        // the others reach only the mocked fetch.
        expect(fetchMock.mock.calls.length > 0, errorCase.name).toBe(errorCase.reachesNetwork);
        for (const [url] of fetchMock.mock.calls) {
          expect(fixture.providerEndpoint, `${adapter.id} needs a providerEndpoint fixture`).toBeDefined();
          expect(String(url), errorCase.name).toMatch(fixture.providerEndpoint!);
        }
      }
    });
  }
});
