import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMembership: vi.fn(),
  findProduct: vi.fn(),
  findBillingPlan: vi.fn(),
  findInvoice: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  upsert: vi.fn(),
  transaction: vi.fn(),
  queryRaw: vi.fn(),
  executeRaw: vi.fn(),
  providerCall: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    vendorMember: { findFirst: mocks.findMembership, create: mocks.create, update: mocks.update, delete: mocks.delete, upsert: mocks.upsert },
    product: { findFirst: mocks.findProduct, create: mocks.create, update: mocks.update, delete: mocks.delete, upsert: mocks.upsert },
    billingPlan: { findFirst: mocks.findBillingPlan, create: mocks.create, update: mocks.update, delete: mocks.delete, upsert: mocks.upsert },
    invoice: { findFirst: mocks.findInvoice, create: mocks.create, update: mocks.update, delete: mocks.delete, upsert: mocks.upsert },
    $transaction: mocks.transaction,
    $queryRaw: mocks.queryRaw,
    $executeRaw: mocks.executeRaw,
  }),
}));
vi.mock("@/lib/product-delivery", () => ({
  revealProductDeliveryConfig: vi.fn((config: {
    destinationEncryptedEnvelope: string | null;
    instructionsEncryptedEnvelope: string | null;
  }) => ({
    destinationUrl: config.destinationEncryptedEnvelope
      ? "https://delivery.example.test/buyer/content"
      : null,
    instructions: config.instructionsEncryptedEnvelope ? "Synthetic delivery instructions" : null,
  })),
  parsePublicHttpsDeliveryUrl: vi.fn(() => ({
    url: "https://delivery.example.test/buyer/content",
    hostname: "delivery.example.test",
    pathPrefix: "/buyer/content",
  })),
}));

import { POST } from "./route";
import { WP4_SANDBOX_FIXTURE } from "@/lib/wp4-sandbox-fixture";

const jobSecret = "test-fixture-job-secret";
const sourceSha = "a".repeat(40);

function request(authorization?: string, sha = sourceSha) {
  return new Request("https://app.example.test/api/admin/ops/payuni/wp4-preflight", {
    method: "POST",
    headers: {
      ...(authorization ? { authorization } : {}),
      ["x-celebratedeal-source-sha"]: sha,
    },
  });
}

function requestWithBody(authorization?: string) {
  const body = new ReadableStream({ start: (controller) => controller.close() });
  return new Request("https://app.example.test/api/admin/ops/payuni/wp4-preflight", {
    method: "POST",
    headers: authorization ? { authorization, ["x-celebratedeal-source-sha"]: sourceSha } : undefined,
    body,
    duplex: "half",
  } as RequestInit);
}

function requestWithHeaders(headers: Record<string, string>) {
  return new Request("https://app.example.test/api/admin/ops/payuni/wp4-preflight", {
    method: "POST",
    headers: {
      authorization: `Bearer ${jobSecret}`,
      ["x-celebratedeal-source-sha"]: sourceSha,
      ...headers,
    },
  });
}

function deliveryConfig(overrides: Record<string, unknown> = {}) {
  return {
    id: "delivery-config-1",
    revision: 1,
    status: "active",
    fulfillmentType: "digital",
    deliveryKind: "digital_link",
    title: "Synthetic delivery",
    destinationEncryptedEnvelope: "sealed-destination",
    destinationMaskedSummary: "Synthetic destination",
    instructionsEncryptedEnvelope: null,
    instructionsMaskedSummary: null,
    allowlist: {
      hostname: "delivery.example.test",
      pathPrefix: "/buyer/content",
      allowQuery: false,
      status: "active",
    },
    ...overrides,
  };
}

function expectNoWritesOrProviders() {
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.update).not.toHaveBeenCalled();
  expect(mocks.delete).not.toHaveBeenCalled();
  expect(mocks.upsert).not.toHaveBeenCalled();
  expect(mocks.transaction).not.toHaveBeenCalled();
  expect(mocks.queryRaw).not.toHaveBeenCalled();
  expect(mocks.executeRaw).not.toHaveBeenCalled();
  expect(mocks.providerCall).not.toHaveBeenCalled();
}

function expectNoReads() {
  expect(mocks.findMembership).not.toHaveBeenCalled();
  expect(mocks.findProduct).not.toHaveBeenCalled();
  expect(mocks.findBillingPlan).not.toHaveBeenCalled();
  expect(mocks.findInvoice).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("JOB_SECRET", jobSecret);
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("PAYUNI_ENV", "sandbox");
  vi.stubEnv("WP4_SANDBOX_EXECUTOR_ENABLED", "true");
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", sourceSha);
  mocks.findMembership.mockResolvedValue({ id: "member-1" });
  mocks.findProduct.mockResolvedValue({
    id: "product-1",
    fulfillmentType: "digital",
    deliveryConfig: deliveryConfig(),
  });
  mocks.findBillingPlan.mockResolvedValue({ id: "plan-1" });
  mocks.findInvoice.mockResolvedValue({ id: "invoice-1" });
});

afterEach(() => vi.unstubAllEnvs());

describe("POST /api/admin/ops/payuni/wp4-preflight", () => {
  it("returns 401 before reading a body or touching the DB", async () => {
    const requestWithUnauthorizedBody = requestWithBody();

    const response = await POST(requestWithUnauthorizedBody);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(requestWithUnauthorizedBody.bodyUsed).toBe(false);
    expectNoReads();
    expectNoWritesOrProviders();
  });

  it("is unavailable outside Preview without DB access", async () => {
    vi.stubEnv("VERCEL_ENV", "production");

    const response = await POST(request(`Bearer ${jobSecret}`));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Not found" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-celebratedeal-wp4-preflight")).toBeNull();
    expectNoReads();
    expectNoWritesOrProviders();
  });

  it("returns only a closed executor-disabled classification in Preview", async () => {
    vi.stubEnv("WP4_SANDBOX_EXECUTOR_ENABLED", "false");

    const response = await POST(request(`Bearer ${jobSecret}`));

    expect(response.status).toBe(404);
    expect(response.headers.get("x-celebratedeal-wp4-preflight")).toBe("EXECUTOR_DISABLED");
    await expect(response.json()).resolves.toEqual({ error: "Not found" });
    expectNoReads();
    expectNoWritesOrProviders();
  });

  it("rejects a source SHA mismatch before DB access", async () => {
    const response = await POST(request(`Bearer ${jobSecret}`, "b".repeat(40)));

    expect(response.status).toBe(404);
    expect(response.headers.get("x-celebratedeal-wp4-preflight")).toBeNull();
    await expect(response.json()).resolves.toEqual({ error: "Not found" });
    expectNoReads();
    expectNoWritesOrProviders();
  });

  it("fails closed when deployment lineage configuration is missing", async () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", undefined);

    const response = await POST(request(`Bearer ${jobSecret}`));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "Service unavailable" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expectNoReads();
    expectNoWritesOrProviders();
  });

  it("rejects any authorized request body without consuming it or touching the DB", async () => {
    const requestWithAuthorizedBody = requestWithBody(`Bearer ${jobSecret}`);

    const response = await POST(requestWithAuthorizedBody);

    expect(response.status).toBe(404);
    expect(requestWithAuthorizedBody.bodyUsed).toBe(false);
    expectNoReads();
    expectNoWritesOrProviders();
  });

  it.each([
    ["positive content length", { "content-length": "1" }],
    ["transfer encoding", { "transfer-encoding": "chunked" }],
  ])("rejects the %s body indicator before DB access", async (_name, headers) => {
    const response = await POST(requestWithHeaders(headers));

    expect(response.status).toBe(404);
    expectNoReads();
    expectNoWritesOrProviders();
  });

  it("accepts a content type header when no body is present", async () => {
    const response = await POST(requestWithHeaders({ "content-type": "application/json" }));

    expect(response.status).toBe(200);
    expectNoWritesOrProviders();
  });

  it.each([
    ["wrong tenant or inactive owner membership", "findMembership"],
    ["inactive or zero-price product", "findProduct"],
    ["inactive or zero-price billing plan", "findBillingPlan"],
    ["wrong tenant, final status, or zero-total invoice", "findInvoice"],
  ] as const)("fails closed for %s", async (_name, missingFixture) => {
    mocks[missingFixture].mockResolvedValueOnce(null);

    const response = await POST(request(`Bearer ${jobSecret}`));

    expect(response.status).toBe(404);
    expect(response.headers.get("x-celebratedeal-wp4-preflight")).toBe("FIXTURE_UNAVAILABLE");
    await expect(response.json()).resolves.toEqual({ error: "Not found" });
    expectNoWritesOrProviders();
  });

  it("uses exact server-owned predicates and returns only readiness booleans", async () => {
    const response = await POST(request(`Bearer ${jobSecret}`));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      ready: true,
      buyerOrder: true,
      platformSubscription: true,
      invoicePayment: true,
    });
    expect(mocks.findMembership).toHaveBeenCalledWith({
      where: { vendorId: WP4_SANDBOX_FIXTURE.vendorId, userId: WP4_SANDBOX_FIXTURE.userId, role: "owner", status: "active", user: { status: "active" } },
      select: { id: true },
    });
    expect(mocks.findProduct).toHaveBeenCalledWith({
      where: {
        id: WP4_SANDBOX_FIXTURE.productId,
        vendorId: WP4_SANDBOX_FIXTURE.vendorId,
        isActive: true,
        fulfillmentTypeConfirmed: true,
        priceCents: { gt: 0 },
        inventory: { gt: 0 },
        checkoutUrl: null,
      },
      select: {
        id: true,
        fulfillmentType: true,
        deliveryConfig: {
          select: {
            id: true,
            revision: true,
            status: true,
            fulfillmentType: true,
            deliveryKind: true,
            title: true,
            destinationEncryptedEnvelope: true,
            destinationMaskedSummary: true,
            instructionsEncryptedEnvelope: true,
            instructionsMaskedSummary: true,
            allowlist: { select: { hostname: true, pathPrefix: true, allowQuery: true, status: true } },
          },
        },
      },
    });
    expect(mocks.findBillingPlan).toHaveBeenCalledWith({
      where: { id: WP4_SANDBOX_FIXTURE.planId, isActive: true, monthlyPriceCents: { gt: 0 } },
      select: { id: true },
    });
    expect(mocks.findInvoice).toHaveBeenCalledWith({
      where: { id: WP4_SANDBOX_FIXTURE.invoiceId, vendorId: WP4_SANDBOX_FIXTURE.vendorId, totalCents: { gt: 0 }, status: { in: ["issued", "overdue"] } },
      select: { id: true },
    });
    expectNoWritesOrProviders();
  });

  it("rejects a product whose delivery configuration is not ready", async () => {
    mocks.findProduct.mockResolvedValueOnce({
      id: "product-1",
      fulfillmentType: "digital",
      deliveryConfig: deliveryConfig({ status: "draft" }),
    });

    const response = await POST(request(`Bearer ${jobSecret}`));

    expect(response.status).toBe(404);
    expectNoWritesOrProviders();
  });

  it.each([
    ["missing destination", { destinationEncryptedEnvelope: null }],
    ["missing allowlist", { allowlist: null }],
    ["inactive allowlist", { allowlist: { hostname: "delivery.example.test", pathPrefix: "/buyer/content", allowQuery: false, status: "draft" } }],
    ["mismatched allowlist", { allowlist: { hostname: "other.example.test", pathPrefix: "/buyer/content", allowQuery: false, status: "active" } }],
  ])("rejects digital delivery with %s", async (_name, overrides) => {
    mocks.findProduct.mockResolvedValueOnce({
      id: "product-1",
      fulfillmentType: "digital",
      deliveryConfig: deliveryConfig(overrides),
    });

    const response = await POST(request(`Bearer ${jobSecret}`));

    expect(response.status).toBe(404);
    expectNoWritesOrProviders();
  });

  it("rejects service delivery without instructions", async () => {
    mocks.findProduct.mockResolvedValueOnce({
      id: "product-1",
      fulfillmentType: "service",
      deliveryConfig: deliveryConfig({
        fulfillmentType: "service",
        deliveryKind: "service_instructions",
        destinationEncryptedEnvelope: null,
        allowlist: null,
      }),
    });

    const response = await POST(request(`Bearer ${jobSecret}`));

    expect(response.status).toBe(404);
    expectNoWritesOrProviders();
  });

  it("maps DB errors to a generic 503 without leaking fixture data", async () => {
    mocks.findInvoice.mockRejectedValue(new Error("invoice-preview vendor-preview raw-db-error"));

    const response = await POST(request(`Bearer ${jobSecret}`));
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toBe('{"error":"Service unavailable"}');
    expect(body).not.toContain("invoice-preview");
    expect(body).not.toContain("vendor-preview");
    expect(body).not.toContain("raw-db-error");
    expectNoWritesOrProviders();
  });
});
