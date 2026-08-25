const NATIVE_ACTION = "/api/billing/plans/select";

export function BillingPlanCheckoutForm({
  csrfToken,
  planId,
  referralClickId,
  label,
}: {
  csrfToken: string;
  planId: string;
  referralClickId?: string | null;
  label: string;
}) {
  return (
    <form action={NATIVE_ACTION} method="post">
      <input type="hidden" name="_csrf" value={csrfToken} />
      <input type="hidden" name="planId" value={planId} />
      {referralClickId ? <input type="hidden" name="platformReferralClickId" value={referralClickId} /> : null}
      <button
        type="submit"
        className="inline-flex h-10 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-white transition hover:bg-primary-dark"
      >
        {label}
      </button>
    </form>
  );
}
