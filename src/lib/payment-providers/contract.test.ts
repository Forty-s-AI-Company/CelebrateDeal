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
import { PaymentWebhookPayload, type PaymentWebhookPayloadInput } from "@/lib/payment-webhooks";

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
const READINESS_SCENARIOS = {
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
} satisfies Record<string, Env>;

type ReadinessScenario = keyof typeof READINESS_SCENARIOS;

/** The same readiness in every scenario, for adapters that ignore configuration. */
function constantReadiness(readiness: CheckoutProviderReadiness) {
  return Object.fromEntries(
    Object.keys(READINESS_SCENARIOS).map((scenario) => [scenario, readiness]),
  ) as Record<ReadinessScenario, CheckoutProviderReadiness>;
}

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

const registryPath = path.join(process.cwd(), "src", "lib", "payment-providers", "index.ts");

/**
 * Reads the registry keys from the source so a new registration cannot bypass
 * this suite. Any entry whose key cannot be read statically (computed key,
 * spread, method, accessor, numeric key) is reported as unsupported, and a
 * missing `providers` object literal is reported too: both fail the suite.
 */
function parseRegistryIds(sourceText: string) {
  const source = ts.createSourceFile(registryPath, sourceText, ts.ScriptTarget.Latest, true);
  const ids: string[] = [];
  const unsupported: string[] = [];
  let registryFound = false;
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== "providers") continue;
      if (!declaration.initializer || !ts.isObjectLiteralExpression(declaration.initializer)) {
        unsupported.push("providers is not an object literal");
        continue;
      }
      registryFound = true;
      for (const property of declaration.initializer.properties) {
        if (ts.isShorthandPropertyAssignment(property)) {
          ids.push(property.name.text);
        } else if (
          ts.isPropertyAssignment(property)
          && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
        ) {
          ids.push(property.name.text);
        } else {
          unsupported.push(property.getText(source));
        }
      }
    }
  }
  if (!registryFound) unsupported.push("providers object literal not found");
  return { ids, unsupported };
}

const registry = parseRegistryIds(fs.readFileSync(registryPath, "utf8"));

type WebhookCase = {
  name: string;
  env: Env;
  rawBody: string;
  /** What the callback means once normalized, independent of the provider's wire format. */
  expectedEventType: PaymentWebhookPayloadInput["eventType"];
  expectedOrderNumber: string;
  expectedAmounts: Pick<PaymentWebhookPayloadInput, "grossAmountCents" | "refundAmountCents">
    & Partial<Pick<PaymentWebhookPayloadInput, "gatewayFeeCents" | "gatewayFeeRefundCents" | "netAmountCents">>;
};
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
  /**
   * Callbacks whose body also carries a `provider` field naming another
   * provider (#652 review MINOR-4). Normalization must ignore it: the payload
   * always names the adapter that parsed it. Required for every adapter.
   */
  providerOverrideWebhooks: WebhookCase[];
  /** Expected checkout readiness under each configuration scenario. */
  readiness: Record<ReadinessScenario, CheckoutProviderReadiness>;
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
      expectedEventType: "paid",
      expectedOrderNumber: "CD-DEMO-CONTRACT",
      expectedAmounts: { grossAmountCents: 99000, refundAmountCents: 0, gatewayFeeCents: 0 },
    },
    {
      name: "refunded",
      env: {},
      rawBody: JSON.stringify({ eventId: "demo-contract-refund", eventType: "refunded", orderNumber: "CD-DEMO-CONTRACT", refundAmountCents: 99000 }),
      expectedEventType: "refunded",
      expectedOrderNumber: "CD-DEMO-CONTRACT",
      expectedAmounts: { grossAmountCents: 0, refundAmountCents: 99000 },
    },
  ],
  providerOverrideWebhooks: [
    {
      name: "body claims PayUni after the known fields",
      env: {},
      rawBody: JSON.stringify({ eventId: "demo-contract-spoof-1", eventType: "paid", orderNumber: "CD-DEMO-CONTRACT", grossAmountCents: 99000, provider: "payuni" }),
      expectedEventType: "paid",
      expectedOrderNumber: "CD-DEMO-CONTRACT",
      expectedAmounts: { grossAmountCents: 99000, refundAmountCents: 0 },
    },
    {
      name: "body claims PayUni before the known fields",
      env: {},
      rawBody: JSON.stringify({ provider: "payuni", eventId: "demo-contract-spoof-2", eventType: "refunded", orderNumber: "CD-DEMO-CONTRACT", refundAmountCents: 99000 }),
      expectedEventType: "refunded",
      expectedOrderNumber: "CD-DEMO-CONTRACT",
      expectedAmounts: { grossAmountCents: 0, refundAmountCents: 99000 },
    },
  ],
  readiness: constantReadiness("local_only"),
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
    {
      name: "paid",
      env: ecpayEnv,
      rawBody: ecpayPaidBody,
      expectedEventType: "paid",
      expectedOrderNumber: "CD-ECPAY-CONTRACT",
      // Decimal TWD on the wire, integer cents after normalization.
      expectedAmounts: { grossAmountCents: 199_000, refundAmountCents: 0, gatewayFeeCents: 3_500 },
    },
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
      expectedEventType: "partially_refunded",
      expectedOrderNumber: "CD-ECPAY-CONTRACT",
      expectedAmounts: { grossAmountCents: 199_000, refundAmountCents: 50_000 },
    },
  ],
  providerOverrideWebhooks: [
    {
      name: "body claims PayUni",
      env: ecpayEnv,
      rawBody: JSON.stringify({ ...JSON.parse(ecpayPaidBody), provider: "payuni", Provider: "payuni" }),
      expectedEventType: "paid",
      expectedOrderNumber: "CD-ECPAY-CONTRACT",
      expectedAmounts: { grossAmountCents: 199_000, refundAmountCents: 0, gatewayFeeCents: 3_500 },
    },
  ],
  readiness: constantReadiness("unavailable"),
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
    {
      name: "UPP paid",
      env: payUniSandboxEnv,
      rawBody: payUniPaidBody,
      expectedEventType: "paid",
      expectedOrderNumber: "CD-SANDBOX-PAID-001",
      // Whole TWD on the wire (TradeAmt 1990); UPP carries no fee fields, so none is invented.
      expectedAmounts: { grossAmountCents: 199_000, refundAmountCents: 0, gatewayFeeCents: 0 },
    },
    {
      name: "refund notice",
      env: payUniSandboxEnv,
      rawBody: payUniBody("refunded"),
      expectedEventType: "refunded",
      expectedOrderNumber: "CD-SANDBOX-PAID-001",
      expectedAmounts: { grossAmountCents: 199_000, refundAmountCents: 199_000, gatewayFeeRefundCents: 3_500 },
    },
  ],
  providerOverrideWebhooks: [
    {
      // The outer form fields are unsigned, so they are the only place a caller
      // can add a field without the merchant key.
      name: "unsigned outer field claims demo",
      env: payUniSandboxEnv,
      rawBody: withField(payUniPaidBody, "provider", () => "demo"),
      expectedEventType: "paid",
      expectedOrderNumber: "CD-SANDBOX-PAID-001",
      expectedAmounts: { grossAmountCents: 199_000, refundAmountCents: 0, gatewayFeeCents: 0 },
    },
    {
      name: "signed inner field claims demo",
      env: payUniSandboxEnv,
      rawBody: buildPayUniSandboxWebhookFixture({
        fixture: "paid",
        merchantId: PAYUNI_MERCHANT_ID,
        hashKey: PAYUNI_HASH_KEY,
        hashIv: PAYUNI_HASH_IV,
        overrides: { provider: "demo" },
      }),
      expectedEventType: "paid",
      expectedOrderNumber: "CD-SANDBOX-PAID-001",
      expectedAmounts: { grossAmountCents: 199_000, refundAmountCents: 0, gatewayFeeCents: 0 },
    },
  ],
  readiness: {
    "nothing configured": "unavailable",
    "PayUni Sandbox configured": "ready",
    "PayUni production configured": "ready",
    // Preview with the live merchant is reserved for the consented probe.
    "live merchant on a Preview deployment": "unavailable",
    "unknown PAYUNI_ENV": "unavailable",
    "credentials with invalid lengths": "unavailable",
  },
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

const registeredIds = registry.ids;

describe("payment adapter registry", () => {
  it("declares every registry entry with a statically readable key", () => {
    expect(registry.unsupported).toEqual([]);
  });

  it("rejects registry entries whose key cannot be read statically", () => {
    const parsed = parseRegistryIds(`
      const extra = {};
      const key = "computed";
      const providers = {
        demo: demoPaymentProvider,
        "ecpay-like": ecpayLikePaymentProvider,
        payUniPaymentProvider,
        [key]: demoPaymentProvider,
        ...extra,
        get lazy() { return demoPaymentProvider; },
        7: demoPaymentProvider,
      };
    `);
    expect(parsed.ids).toEqual(["demo", "ecpay-like", "payUniPaymentProvider"]);
    expect(parsed.unsupported).toEqual([
      "[key]: demoPaymentProvider",
      "...extra",
      "get lazy() { return demoPaymentProvider; }",
      "7: demoPaymentProvider",
    ]);
    expect(parseRegistryIds("const providers = buildProviders();").unsupported).toEqual(["providers is not an object literal", "providers object literal not found"]);
    expect(parseRegistryIds("export const other = {};").unsupported).toEqual(["providers object literal not found"]);
  });

  it("registers PayUni and resolves every registered ID outside production", () => {
    expect(registeredIds).toContain("payuni");
    for (const id of registeredIds) {
      expect(getPaymentProvider(id, {}).id, id).toBeTruthy();
    }
  });

  it("treats Object.prototype keys exactly like an unknown provider", () => {
    const unsupported = (providerId: string | null, env: Env) => {
      try {
        getPaymentProvider(providerId, env);
        return { threw: false as const };
      } catch (error) {
        return { threw: true as const, type: (error as Error).constructor, message: (error as Error).message };
      }
    };
    const prototypeKeys = [
      "constructor",
      "__proto__",
      "toString",
      "valueOf",
      "hasOwnProperty",
      "isPrototypeOf",
      "propertyIsEnumerable",
      "toLocaleString",
      "__defineGetter__",
      "__lookupGetter__",
    ];
    // Every one of these is reachable through plain bracket access on an object literal.
    for (const key of prototypeKeys) expect(key in {}, key).toBe(true);

    for (const env of [{}, { VERCEL_ENV: "production" }] satisfies Env[]) {
      const unknown = unsupported("not-a-registered-provider", env);
      expect(unknown).toEqual({ threw: true, type: Error, message: "Unsupported payment provider" });
      for (const key of prototypeKeys) {
        expect(registeredIds, key).not.toContain(key);
        expect(unsupported(key, env), key).toEqual(unknown);
      }
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
      expect(payload.eventType, webhook.name).toBe(webhook.expectedEventType);
      expect(payload.orderNumber, webhook.name).toBe(webhook.expectedOrderNumber);
      expect(payload, webhook.name).toMatchObject(webhook.expectedAmounts);
    }
  });

  it("ignores a provider field in the callback body and names this adapter", async () => {
    expect(fixture.providerOverrideWebhooks.length).toBeGreaterThan(0);
    for (const webhook of fixture.providerOverrideWebhooks) {
      applyEnv(webhook.env);
      const { payload } = await adapter.normalizePayload(webhook.rawBody);
      expect(PaymentWebhookPayload.safeParse(payload).success, webhook.name).toBe(true);
      expect(payload.provider, webhook.name).toBe(adapter.id);
      expect(payload.eventType, webhook.name).toBe(webhook.expectedEventType);
      expect(payload.orderNumber, webhook.name).toBe(webhook.expectedOrderNumber);
      expect(payload, webhook.name).toMatchObject(webhook.expectedAmounts);
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

  it.each(Object.entries(READINESS_SCENARIOS) as Array<[ReadinessScenario, Env]>)(
    "returns only the expected readiness enum value without configuration values (%s)",
    (scenario, env) => {
      applyEnv(env);
      const readiness: unknown = adapter.checkoutReadiness();
      expect(typeof readiness).toBe("string");
      expect(CHECKOUT_READINESS_VALUES).toContain(readiness);
      expect(readiness).toBe(fixture.readiness[scenario]);
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
