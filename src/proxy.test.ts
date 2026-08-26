import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { LINEAGE_PAYLOAD } from "@/lib/preview-lineage";
import { config, proxy } from "./proxy";

const MARKER_PATH = "/__celebratedeal_wp187_fingerprint.json";

function request(pathname: string, method = "GET") {
  return new NextRequest(`https://staging.example.test${pathname}`, { method });
}

describe("Next Proxy lineage marker", () => {
  it("matches only the public marker path", () => {
    expect(config.matcher).toBe("/__celebratedeal_wp187_fingerprint\\.json");
    expect(proxy(request(MARKER_PATH)).status).toBe(200);
    expect(proxy(request("/login")).status).toBe(200);
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
