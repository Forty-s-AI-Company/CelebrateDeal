/**
 * The MVP launch does not charge for metered usage. Keep this as a code-level
 * policy instead of a runtime flag so every new billing generation has the
 * same auditable behaviour.
 */
export const MVP_USAGE_BILLING_ENABLED = false;

/**
 * Returns the charge that may be added to a newly generated invoice for
 * metered usage. Usage is still measured for quota and reconciliation.
 */
export function usageFeeForNewBillingGeneration(_calculatedUsageFeeCents: number) {
  return MVP_USAGE_BILLING_ENABLED ? Math.max(0, _calculatedUsageFeeCents) : 0;
}
