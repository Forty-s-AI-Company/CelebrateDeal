import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LINEAGE_PAYLOAD } from "@/lib/preview-lineage";
const statusCheck = vi.hoisted(() => vi.fn());
vi.mock("@/lib/public-landing-page-status", () => ({ publicLandingPageStatus: statusCheck }));
beforeEach(() => { vi.clearAllMocks(); statusCheck.mockResolvedValue(200); });

import { config, proxy } from "./proxy";

const MARKER_PATH = "/__celebratedeal_wp187_fingerprint.json";

function request(pathname: string, method = "GET") {
  return new NextRequest(`https://staging.example.test${pathname}`, { method });
}

describe("Next Proxy lineage marker", () => {
  it("matches only the public marker path", async () => {
    expect(config.matcher).toEqual(["/__celebratedeal_wp187_fingerprint\\.json", "/lp/:path*"]);
    expect((await proxy(request(MARKER_PATH))).status).toBe(200);
    expect((await proxy(request("/login"))).status).toBe(200);
  });

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

describe("public Funnel HTTP preflight", () => {
  it("returns an anonymous noncacheable 404 before streaming", async () => {
    statusCheck.mockResolvedValue(404);
    const response = await proxy(request("/lp/missing"));
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await response.text()).toContain("<h1>404</h1>");
    expect(statusCheck).toHaveBeenCalledWith("/lp/missing", expect.any(String));
  });
  it("returns an empty HEAD 404", async () => {
    statusCheck.mockResolvedValue(404);
    const response = await proxy(request("/lp/missing", "HEAD"));
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
  });
  it("keeps read failures distinct from missing pages without exposing their reason", async () => {
    statusCheck.mockRejectedValue(new Error("synthetic_database_failure"));
    const response = await proxy(request("/lp/example"));
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("30");
    expect(await response.text()).not.toContain("synthetic_database_failure");
  });
  it("does not read the database for non-public routes or POST", async () => {
    await proxy(request("/login"));
    await proxy(request(MARKER_PATH));
    await proxy(request("/lp/example", "POST"));
    expect(statusCheck).not.toHaveBeenCalled();
  });
  it.each(["/lp/example/offer/checkout", "/lp/example/watch/play"])("preserves the nested route contract for %s", async (path) => {
    statusCheck.mockRejectedValue(new Error("must-not-query-document-loader"));
    for (const method of ["GET", "HEAD"]) {
      const response = await proxy(request(path, method));
      expect(response.status).toBe(200);
      expect(response.headers.get("x-middleware-next")).toBe("1");
    }
    expect(statusCheck).not.toHaveBeenCalled();
  });
  it("retains visitor initialization for an available page", async () => {
    const response = await proxy(request("/lp/example"));
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("celebratedeal_funnel_visitor=");
    expect(response.headers.get("x-middleware-request-cookie")).toContain("celebratedeal_funnel_visitor=");
  });
  it("checks unavailable pages even when the visitor identifier is already present", async () => {
    statusCheck.mockResolvedValue(404);
    const incoming = new NextRequest("https://staging.example.test/lp/example", { headers: { cookie: "celebratedeal_funnel_visitor=synthetic-visitor-1234567890" } });
    expect((await proxy(incoming)).status).toBe(404);
    expect(statusCheck).toHaveBeenCalledWith("/lp/example", "synthetic-visitor-1234567890");
  });
});
