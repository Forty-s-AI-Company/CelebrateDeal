import { describe, expect, it } from "vitest";
import { classifyPublicLiveBrowserDiagnostic, publicLiveTransportFailure } from "./public-live-browser-diagnostic";

describe("public live browser diagnostics", () => {
  it.each([
    ["ECONNRESET private-value", "CONNECTION_RESET"], ["socket hang up private-value", "CONNECTION_RESET"],
    ["ECONNREFUSED private-value", "CONNECTION_REFUSED"], ["ENOTFOUND private-value", "DNS"],
    ["EAI_AGAIN private-value", "DNS"], ["Request context disposed private-value", "CONTEXT_CLOSED"],
    ["Timeout private-value", "TIMEOUT"], ["private-value", "UNKNOWN"],
  ])("returns only a closed transport category", (message, category) => {
    expect(publicLiveTransportFailure(new Error(message))).toBe(category);
    expect(publicLiveTransportFailure(new Error(message))).not.toContain("private-value");
  });
  it("reports fixed HTTP and network causes without forwarding raw text", () => {
    expect(classifyPublicLiveBrowserDiagnostic("Error: PUBLIC_LIVE:ADMISSION:HTTP:403")).toBe("public_live stage=admission cause=http_403");
    expect(classifyPublicLiveBrowserDiagnostic("PUBLIC_LIVE:NAVIGATION:NETWORK:CONNECTION_RESET")).toBe("public_live stage=navigation cause=network_connection_reset");
  });
  it.each([null, "PUBLIC_LIVE:ADMISSION:HTTP:600", "PUBLIC_LIVE:ADMISSION:HTTP:403 private-value", "PUBLIC_LIVE:ADMISSION:NETWORK:private-value", "PUBLIC_LIVE:ADMISSION:HTTP:403\n::error::private-value", "PUBLIC_LIVE:OTHER:HTTP:403", "x".repeat(200)])("rejects arbitrary or injected diagnostics", value => {
    expect(classifyPublicLiveBrowserDiagnostic(value)).toBeNull();
  });
});
