import { WP4_SANDBOX_FIXTURE } from "@/lib/wp4-sandbox-fixture";
import { resolveWp4ExpectedSourceSha } from "@/lib/wp4-preview-runtime";
import type { Wp4PayUniPurpose } from "@/lib/wp4-payuni-sandbox-reconciliation";

type FixtureIdentity = Readonly<Record<string, string>>;

const PURPOSE_IDENTITIES: Readonly<Record<Wp4PayUniPurpose, FixtureIdentity>> = Object.freeze({
  buyer_order: Object.freeze({ productId: WP4_SANDBOX_FIXTURE.productId }),
  platform_subscription: Object.freeze({ planId: WP4_SANDBOX_FIXTURE.planId }),
  invoice_payment: Object.freeze({ invoiceId: WP4_SANDBOX_FIXTURE.invoiceId }),
});

/**
 * Produces the immutable source marker used solely by the guarded WP4 Preview
 * Sandbox executor. The caller cannot provide a source SHA, purpose, or
 * fixture identity: all three are selected by server code and disabled outside
 * Preview/Sandbox.
 */
export function wp4SourceBoundTransactionMetadata(
  purpose: Wp4PayUniPurpose,
  identity: FixtureIdentity,
) {
  if (
    process.env.VERCEL_ENV !== "preview"
    || process.env.PAYUNI_ENV !== "sandbox"
    || process.env.WP4_SANDBOX_EXECUTOR_ENABLED !== "true"
  ) return null;

  const expected = PURPOSE_IDENTITIES[purpose];
  const expectedSourceSha = resolveWp4ExpectedSourceSha();
  if (!expectedSourceSha) return null;
  if (
    Object.keys(identity).length !== Object.keys(expected).length
    || Object.entries(expected).some(([key, value]) => identity[key] !== value)
  ) return null;

  return { wp4SourceCommit: expectedSourceSha };
}
