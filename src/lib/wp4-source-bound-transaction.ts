import { WP4_SANDBOX_FIXTURE } from "@/lib/wp4-sandbox-fixture";
import { resolveWp4ExpectedSourceSha } from "@/lib/wp4-preview-runtime";

const identities = {
  buyer_order: { productId: WP4_SANDBOX_FIXTURE.productId },
  platform_subscription: { planId: WP4_SANDBOX_FIXTURE.planId },
} as const;

/** Only server-selected synthetic checkouts receive a Preview source marker. */
export function wp4SourceBoundTransactionMetadata(
  purpose: keyof typeof identities,
  identity: Readonly<Record<string, string>>,
) {
  if (process.env.VERCEL_ENV !== "preview"
    || process.env.PAYUNI_ENV !== "sandbox"
    || process.env.WP4_SANDBOX_EXECUTOR_ENABLED !== "true") return null;
  const expected = identities[purpose];
  const source = resolveWp4ExpectedSourceSha();
  if (!expected || !source
    || Object.keys(identity).length !== Object.keys(expected).length
    || Object.entries(expected).some(([key, value]) => identity[key] !== value)) return null;
  return { wp4SourceCommit: source };
}
