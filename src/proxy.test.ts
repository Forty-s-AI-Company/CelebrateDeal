import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { LINEAGE_PAYLOAD } from "@/lib/preview-lineage";
import { config, proxy } from "./proxy";

const MARKER_PATH = "/__celebratedeal_wp187_fingerprint.json";

function request(pathname: string, method = "GET") {
  return new NextRequest(`https://staging.example.test${pathname}`, { method });
}

describe("Next Proxy lineage marker", () => {
  it("matches the public marker and Funnel routes", () => {
    expect(config.matcher).toEqual(["/__celebratedeal_wp187_fingerprint\\.json", "/lp/:path*"]);
    expect(proxy(request(MARKER_PATH)).status).toBe(200);
    expect(proxy(request("/login")).status).toBe(200);
  });

  it("injects one opaque Funnel visitor pseudonym on the first LP request and reuses a valid cookie", () => {
    const first = proxy(request("/lp/offer"));
    expect(first.headers.get("set-cookie")).toMatch(/celebratedeal_funnel_visitor=[A-Za-z0-9-]{20,100}/u);
    expect(first.headers.get("x-middleware-request-cookie")).toContain("celebratedeal_funnel_visitor=");

    const repeat = proxy(new NextRequest("https://staging.example.test/lp/offer", {
      headers: { cookie: "celebratedeal_funnel_visitor=visitor-12345678901234567890" },
    }));
    expect(repeat.headers.get("set-cookie")).toBeNull();
    expect(repeat.headers.get("x-middleware-request-cookie")).toBeNull();

    const invalid = proxy(new NextRequest("https://staging.example.test/lp/offer", {
      headers: { cookie: "celebratedeal_funnel_visitor=invalid; existing=value" },
    }));
    const forwarded = invalid.headers.get("x-middleware-request-cookie") ?? "";
    expect(forwarded).toContain("existing=value");
    expect(forwarded.match(/celebratedeal_funnel_visitor=/gu) ?? []).toHaveLength(1);
  });

  it("returns the deterministic GET contract", async () => {
    const response = proxy(request(MARKER_PATH));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await response.json()).toEqual(LINEAGE_PAYLOAD);
  });

  it("returns an empty HEAD response and rejects unsupported methods", async () => {
    const head = proxy(request(MARKER_PATH, "HEAD"));
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");

    const post = proxy(request(MARKER_PATH, "POST"));
    expect(post.status).toBe(405);
    expect(post.headers.get("allow")).toBe("GET, HEAD");
  });
});
