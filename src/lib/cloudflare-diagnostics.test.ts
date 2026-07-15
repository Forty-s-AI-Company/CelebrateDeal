import { describe, expect, it } from "vitest";
import { getCloudflareStreamDiagnostics } from "@/lib/cloudflare-diagnostics";

const envKey = (...parts: string[]) => parts.join("_");

type CloudflareFixture = {
  accountId: string;
  streamCredential: string;
  webhookCredential: string;
};

const fixture: CloudflareFixture = {
  accountId: "diagnostic-test-account-42",
  streamCredential: "diagnostic-test-stream-credential-7",
  webhookCredential: "diagnostic-test-webhook-credential-9",
};

function cloudflareEnv(values: Partial<typeof fixture> = {}): NodeJS.ProcessEnv {
  const configured = { ...fixture, ...values };

  return {
    NODE_ENV: "test",
    [envKey("CLOUDFLARE", "ACCOUNT", "ID")]: configured.accountId,
    [envKey("CLOUDFLARE", "STREAM", "TOKEN")]: configured.streamCredential,
    [envKey("CLOUDFLARE", "STREAM", "WEBHOOK", "SECRET")]: configured.webhookCredential,
  };
}

describe("getCloudflareStreamDiagnostics", () => {
  it("reports configured Cloudflare values without serializing their originals", () => {
    const diagnostics = getCloudflareStreamDiagnostics(cloudflareEnv());
    const serialized = JSON.stringify(diagnostics);

    expect(diagnostics.ok).toBe(true);
    expect(diagnostics.accountId).toEqual({ configured: true, length: fixture.accountId.length });
    expect(diagnostics.streamToken).toMatchObject({
      configured: true,
      shape: `present:${fixture.streamCredential.length}chars`,
    });
    expect(diagnostics.webhookSecret).toMatchObject({
      configured: true,
      shape: `present:${fixture.webhookCredential.length}chars`,
    });
    expect(diagnostics.webhookModes.every((mode) => mode.configured)).toBe(true);
    expect(diagnostics.endpoints).toEqual([
      "https://api.cloudflare.com/client/v4/accounts/<configured-account-id>/stream/direct_upload",
      "https://api.cloudflare.com/client/v4/accounts/<configured-account-id>/stream/live_inputs",
      "https://api.cloudflare.com/client/v4/accounts/<configured-account-id>/stream/<uid>",
    ]);

    for (const value of Object.values(fixture)) {
      expect(serialized).not.toContain(value);
    }
    expect(serialized).toContain(`present:${fixture.streamCredential.length}chars`);
    expect(serialized).toContain(`present:${fixture.webhookCredential.length}chars`);
  });

  it.each([undefined, "", "   ", "diagnostic-example-value", "diagnostic...value"])(
    "treats %j Cloudflare values as missing",
    (invalidValue) => {
      const diagnostics = getCloudflareStreamDiagnostics(
        cloudflareEnv({
          accountId: invalidValue,
          streamCredential: invalidValue,
          webhookCredential: invalidValue,
        }),
      );

      expect(diagnostics.ok).toBe(false);
      expect(diagnostics.accountId.configured).toBe(false);
      expect(diagnostics.streamToken).toEqual({ configured: false, shape: "missing" });
      expect(diagnostics.webhookSecret).toMatchObject({ configured: false, shape: "missing" });
      expect(diagnostics.webhookModes.every((mode) => !mode.configured)).toBe(true);
    },
  );
});
