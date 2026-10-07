import { afterEach, describe, expect, it, vi } from "vitest";
import { WP4_SANDBOX_FIXTURE } from "@/lib/wp4-sandbox-fixture";
import { wp4SourceBoundTransactionMetadata } from "@/lib/wp4-source-bound-transaction";

const sourceSha = "a".repeat(40);

afterEach(() => vi.unstubAllEnvs());

function enablePreviewSandbox() {
  vi.stubEnv("VERCEL_PROJECT_ID", "");
  vi.stubEnv("WP4_DISPOSABLE_RUNNER_MARKER", "verified-loopback");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://127.0.0.1:3000");
  vi.stubEnv("DATABASE_URL", "postgresql://synthetic:synthetic@127.0.0.1:5433/celebratedeal_test");
  vi.stubEnv("DIRECT_URL", "postgresql://synthetic:synthetic@127.0.0.1:5433/celebratedeal_test");
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("PAYUNI_ENV", "sandbox");
  vi.stubEnv("WP4_SANDBOX_EXECUTOR_ENABLED", "true");
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", sourceSha);
}

describe("WP4 source-bound transaction metadata", () => {
  it("adds only a server-resolved source marker for each exact fixture identity", () => {
    enablePreviewSandbox();
    expect(wp4SourceBoundTransactionMetadata("buyer_order", { productId: WP4_SANDBOX_FIXTURE.productId }))
      .toEqual({ wp4SourceCommit: sourceSha });
    expect(wp4SourceBoundTransactionMetadata("platform_subscription", { planId: WP4_SANDBOX_FIXTURE.planId }))
      .toEqual({ wp4SourceCommit: sourceSha });
    expect(wp4SourceBoundTransactionMetadata("invoice_payment", { invoiceId: WP4_SANDBOX_FIXTURE.invoiceId }))
      .toEqual({ wp4SourceCommit: sourceSha });
  });

  it("fails closed outside guarded Preview Sandbox or for a non-fixture identity", () => {
    expect(wp4SourceBoundTransactionMetadata("buyer_order", { productId: WP4_SANDBOX_FIXTURE.productId })).toBeNull();
    enablePreviewSandbox();
    expect(wp4SourceBoundTransactionMetadata("buyer_order", { productId: "caller-controlled" })).toBeNull();
    vi.stubEnv("PAYUNI_ENV", "production");
    expect(wp4SourceBoundTransactionMetadata("buyer_order", { productId: WP4_SANDBOX_FIXTURE.productId })).toBeNull();
  });
});
