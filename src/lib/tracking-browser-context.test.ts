import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureTrackingBrowserContext, protectTrackingBrowserContext, revealTrackingBrowserContext } from "./tracking-browser-context";

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://tracking.example.test");
  vi.stubEnv("CSRF_SECRET", "synthetic-tracking-context-key-at-least-32-bytes");
});
afterEach(() => vi.unstubAllEnvs());
const headers = (referer?: string, userAgent = "SyntheticTrackingBrowser/1.0") => new Headers({ "user-agent": userAgent, ...(referer ? { referer } : {}) });

describe("server-derived encrypted tracking browser context", () => {
  it("retains only a same-origin public path and strips tokens/query/fragment", () => {
    expect(captureTrackingBrowserContext(headers("https://tracking.example.test/live/synthetic?token=synthetic#buyer"), "/register"))
      .toEqual({ sourceUrl: "https://tracking.example.test/live/synthetic", userAgent: "SyntheticTrackingBrowser/1.0" });
  });
  it.each(["https://foreign.example.test/live/synthetic", "https://tracking.example.test/portal/orders/synthetic-grant", "not a URL"])("untrusted/private Referer cannot override a server-owned path", referer => {
    expect(captureTrackingBrowserContext(headers(referer), "/verify-registration")?.sourceUrl).toBe("https://tracking.example.test/verify-registration");
  });
  it("never fabricates a browser identity or public page for a callback", () => {
    expect(captureTrackingBrowserContext(new Headers(), "/register")).toBeNull();
    expect(captureTrackingBrowserContext(headers(undefined, "x".repeat(513)), "/register")).toBeNull();
    expect(captureTrackingBrowserContext(headers())).toBeNull();
    expect(captureTrackingBrowserContext(headers(), "//foreign.example.test")).toBeNull();
  });
  it("encrypts with tenant and source binding and rejects swaps/tampering", () => {
    const context = captureTrackingBrowserContext(headers(), "/register")!;
    const encrypted = protectTrackingBrowserContext("vendor-a", "source-a", context);
    expect(encrypted).not.toContain(context.userAgent);
    expect(encrypted).not.toContain(context.sourceUrl);
    expect(revealTrackingBrowserContext("vendor-a", "source-a", encrypted)).toEqual(context);
    expect(() => revealTrackingBrowserContext("vendor-b", "source-a", encrypted)).toThrow("Tracking browser context unavailable.");
    expect(() => revealTrackingBrowserContext("vendor-a", "source-b", encrypted)).toThrow("Tracking browser context unavailable.");
    expect(() => revealTrackingBrowserContext("vendor-a", "source-a", encrypted.slice(0, -3) + "abc")).toThrow("Tracking browser context unavailable.");
  });
  it.each(["https://synthetic:synthetic@tracking.example.test/register", "https://tracking.example.test/register?token=synthetic", "https://tracking.example.test/register#synthetic", "ftp://tracking.example.test/register"])("rejects unsafe persisted source context", sourceUrl => {
    expect(() => protectTrackingBrowserContext("vendor-a", "source-a", { sourceUrl, userAgent: "SyntheticTrackingBrowser/1.0" })).toThrow();
  });
});
