import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LINEAGE_PAYLOAD } from "@/lib/preview-lineage";

const statusCheck = vi.hoisted(() => vi.fn());
const captureOperationalError = vi.hoisted(() => vi.fn());
vi.mock("@/lib/public-landing-page-status", () => ({ publicLandingPageStatus: statusCheck }));
vi.mock("@/lib/monitoring", () => ({ captureOperationalError }));

import { config, proxy } from "./proxy";

const MARKER_PATH = "/__celebratedeal_wp187_fingerprint.json";
const VISITOR = "synthetic-visitor-1234567890";

function request(pathname: string, method = "GET", headers?: Record<string, string>) {
  return new NextRequest(`https://staging.example.test${pathname}`, { method, headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  statusCheck.mockResolvedValue(200);
});

describe("Next Proxy matcher", () => {
  const matches = (url: string) => unstable_doesMiddlewareMatch({ config, url });

  it("runs for the marker, public funnels and every HTML document", () => {
    for (const path of [MARKER_PATH, "/", "/login", "/register", "/dashboard", "/lp/example", "/lp/example/thank-you", "/lp/example/offer/checkout", "/lives/abc/presenter", "/admin/billing", "/policies/privacy", "/portal/shop/learn/course-1", "/browser-qa/funnel-elements/custom-code", "/apiary", "/monitoring-dashboard"]) {
      expect(matches(path), path).toBe(true);
    }
  });

  it("skips API routes, build assets, the Sentry tunnel, the sandbox document, the certificate SVG and public files", () => {
    for (const path of ["/api/security/csp-report", "/api/billing/plans/select", "/_next/static/chunks/app.js", "/_next/image?url=x", "/monitoring", "/monitoring?o=1", "/sandbox/custom-code", "/portal/shop/learn/course-1/certificate", "/favicon.ico", "/presenter-segmentation/worker.js", "/presenter-segmentation/vision_wasm_internal.wasm", "/presenter-segmentation/selfie_segmenter.tflite", "/fonts/funnel/0122c218a937e467-s.woff2", "/placeholder.svg", "/funnel-illustrations/hero.png"]) {
      expect(matches(path), path).toBe(false);
    }
  });

  it("still serves the marker and passes other documents through", async () => {
    expect((await proxy(request(MARKER_PATH))).status).toBe(200);
    expect((await proxy(request("/login"))).status).toBe(200);
  });
});

describe("Content Security Policy headers (F-156)", () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  const nonceOf = (policy: string | null) => /'nonce-([A-Za-z0-9+/]{22}==)'/u.exec(policy ?? "")?.[1];

  it("sends a Report-Only policy with a fresh nonce and hands the same nonce to rendering", async () => {
    vi.stubEnv("CSP_ENFORCE", "");
    const first = await proxy(request("/login"));
    const second = await proxy(request("/login"));
    const policy = first.headers.get("content-security-policy-report-only");
    const nonce = nonceOf(policy);
    expect(nonce).toBeTruthy();
    expect(nonceOf(second.headers.get("content-security-policy-report-only"))).not.toBe(nonce);
    expect(first.headers.get("content-security-policy")).toBeNull();
    expect(first.headers.get("reporting-endpoints")).toBe('csp-endpoint="/api/security/csp-report"');
    // Next.js reads the nonce from the request CSP header; Server Components read x-nonce.
    expect(first.headers.get("x-middleware-request-x-nonce")).toBe(nonce);
    expect(first.headers.get("x-middleware-request-content-security-policy")).toBe(policy);
    expect(policy).toContain("'strict-dynamic'");
    expect(policy).not.toContain("'unsafe-eval'");
    expect(policy).not.toMatch(/script-src[^;]*'unsafe-inline'/u);
  });

  it("replaces a client-supplied nonce or CSP request header", async () => {
    const response = await proxy(request("/login", "GET", {
      "x-nonce": "AAAAAAAAAAAAAAAAAAAAAA==",
      "content-security-policy": "script-src 'nonce-AAAAAAAAAAAAAAAAAAAAAA=='",
      "content-security-policy-report-only": "script-src 'nonce-AAAAAAAAAAAAAAAAAAAAAA=='",
    }));
    const nonce = response.headers.get("x-middleware-request-x-nonce");
    expect(nonce).not.toBe("AAAAAAAAAAAAAAAAAAAAAA==");
    expect(response.headers.get("x-middleware-request-content-security-policy")).toContain(`'nonce-${nonce}'`);
    expect(response.headers.get("x-middleware-override-headers")).toContain("content-security-policy");
    expect(response.headers.get("x-middleware-request-content-security-policy-report-only")).toBeNull();
  });

  it("enforces the same policy and keeps a report-only preview when CSP_ENFORCE=true", async () => {
    vi.stubEnv("CSP_ENFORCE", "true");
    const response = await proxy(request("/dashboard"));
    const enforced = response.headers.get("content-security-policy");
    expect(enforced).toBeTruthy();
    expect(enforced).toBe(response.headers.get("x-middleware-request-content-security-policy"));
    expect(response.headers.get("content-security-policy-report-only")).toContain("style-src-elem");
    expect(nonceOf(response.headers.get("content-security-policy-report-only"))).toBe(nonceOf(enforced));
  });

  it("stays Report-Only for an invalid CSP_ENFORCE value", async () => {
    vi.stubEnv("CSP_ENFORCE", "yes");
    const response = await proxy(request("/dashboard"));
    expect(response.headers.get("content-security-policy")).toBeNull();
    expect(response.headers.get("content-security-policy-report-only")).toBeTruthy();
  });

  it("gives public funnel documents the funnel surface, also when issuing a visitor cookie", async () => {
    const fresh = await proxy(request("/lp/example"));
    expect(fresh.headers.get("set-cookie")).toContain("celebratedeal_funnel_visitor=");
    expect(fresh.headers.get("content-security-policy-report-only")).toContain("https://www.googletagmanager.com");
    expect(fresh.headers.get("x-middleware-request-cookie")).toContain("celebratedeal_funnel_visitor=");
    expect(fresh.headers.get("x-middleware-request-x-nonce")).toBe(nonceOf(fresh.headers.get("content-security-policy-report-only")));
    const returning = await proxy(request("/lp/example", "GET", { cookie: `celebratedeal_funnel_visitor=${VISITOR}` }));
    expect(returning.headers.get("content-security-policy-report-only")).toContain("https://connect.facebook.net");
    expect((await proxy(request("/dashboard"))).headers.get("content-security-policy-report-only")).not.toContain("googletagmanager");
  });

  it("adds no policy to the marker JSON", async () => {
    const response = await proxy(request(MARKER_PATH));
    expect(response.headers.get("content-security-policy-report-only")).toBeNull();
  });
});

describe("Next Proxy lineage marker", () => {

  it("returns the deterministic GET contract", async () => {
    const response = await proxy(request(MARKER_PATH));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await response.json()).toEqual(LINEAGE_PAYLOAD);
  });

  it("returns an empty HEAD response and rejects unsupported methods", async () => {
    const head = await proxy(request(MARKER_PATH, "HEAD"));
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");

    const post = await proxy(request(MARKER_PATH, "POST"));
    expect(post.status).toBe(405);
    expect(post.headers.get("allow")).toBe("GET, HEAD");
  });
});

describe("public Funnel HTTP pre-stream status", () => {
  it("returns an anonymous noncacheable 404 before streaming", async () => {
    statusCheck.mockResolvedValue(404);
    const response = await proxy(request("/lp/missing-page"));
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("set-cookie")).toBeNull();
    const body = await response.text();
    expect(body).toContain("<h1>404</h1>");
    expect(body).toContain("找不到此頁面");
    expect(body).not.toContain("missing-page");
    expect(statusCheck).toHaveBeenCalledWith("/lp/missing-page");
  });

  it("returns an empty HEAD 404", async () => {
    statusCheck.mockResolvedValue(404);
    const response = await proxy(request("/lp/missing", "HEAD"));
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
  });

  it("checks a step path the same way", async () => {
    statusCheck.mockResolvedValue(404);
    expect((await proxy(request("/lp/example/thank-you"))).status).toBe(404);
    expect(statusCheck).toHaveBeenCalledWith("/lp/example/thank-you");
  });

  it("answers 503 for a read failure without exposing its reason", async () => {
    statusCheck.mockRejectedValue(new Error("synthetic_database_failure at db.internal:5432"));
    const response = await proxy(request("/lp/example"));
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("30");
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    const body = await response.text();
    expect(body).not.toContain("synthetic_database_failure");
    expect(body).not.toContain("db.internal");
    expect(body).not.toContain("/lp/example");
    // Only fixed, PII-free context is reported; the slug and visitor never are.
    expect(captureOperationalError).toHaveBeenCalledTimes(1);
    const [, context] = captureOperationalError.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(context).toEqual({ source: "public_landing_page", operation: "pre_stream_status", status: "failed" });
  });

  it("still answers 503 when monitoring itself fails", async () => {
    statusCheck.mockRejectedValue(new Error("synthetic_database_failure"));
    captureOperationalError.mockImplementationOnce(() => { throw new Error("monitoring_down"); });
    expect((await proxy(request("/lp/example"))).status).toBe(503);
  });

  it("does not read the database for non-public routes or Server Action POSTs", async () => {
    await proxy(request("/login"));
    await proxy(request(MARKER_PATH));
    await proxy(request("/lp/example", "POST"));
    await proxy(request("/lp/", "GET"));
    expect(statusCheck).not.toHaveBeenCalled();
  });

  it("checks client-router RSC navigations and prefetches the same as HTML documents", async () => {
    // Next strips Flight headers before Proxy in production; even if they
    // were visible they must not change the availability decision.
    statusCheck.mockResolvedValue(404);
    const variants: Array<Record<string, string>> = [{ rsc: "1" }, { "next-router-prefetch": "1" }, {}];
    for (const headers of variants) {
      expect((await proxy(request("/lp/example?_rsc=abc", "GET", headers))).status).toBe(404);
    }
    expect(statusCheck).toHaveBeenCalledTimes(3);
    expect(statusCheck).toHaveBeenCalledWith("/lp/example");
  });

  it.each(["/lp/example/offer/checkout", "/lp/example/watch/play"])("keeps the nested route contract for %s", async (path) => {
    statusCheck.mockRejectedValue(new Error("must-not-query"));
    for (const method of ["GET", "HEAD"]) {
      const response = await proxy(request(path, method));
      expect(response.status).toBe(200);
      expect(response.headers.get("x-middleware-next")).toBe("1");
    }
    expect(statusCheck).not.toHaveBeenCalled();
  });

  it("keeps visitor initialization for an available page with the same visitor for SSR and the browser", async () => {
    const response = await proxy(request("/lp/example"));
    expect(response.status).toBe(200);
    const cookie = response.headers.get("set-cookie") ?? "";
    const visitorId = /celebratedeal_funnel_visitor=([^;]+)/u.exec(cookie)?.[1];
    expect(visitorId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(response.headers.get("x-middleware-request-cookie")).toContain(`celebratedeal_funnel_visitor=${visitorId}`);
    // The pre-stream check is content-free and no longer takes a visitor (F-015).
    expect(statusCheck).toHaveBeenCalledWith("/lp/example");
  });

  it("checks availability for a returning visitor and does not reissue the identifier", async () => {
    const available = await proxy(request("/lp/example", "GET", { cookie: `celebratedeal_funnel_visitor=${VISITOR}` }));
    expect(available.status).toBe(200);
    expect(available.headers.get("set-cookie")).toBeNull();
    statusCheck.mockResolvedValue(404);
    expect((await proxy(request("/lp/example", "GET", { cookie: `celebratedeal_funnel_visitor=${VISITOR}` }))).status).toBe(404);
    expect(statusCheck).toHaveBeenCalledWith("/lp/example");
  });
});
