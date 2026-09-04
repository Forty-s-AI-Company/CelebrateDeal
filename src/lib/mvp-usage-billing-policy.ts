/**
 * Metered usage is enabled for newly generated billing. Keep this as a
 * code-level policy so every generation has the same auditable behaviour;
 * persisted invoices remain immutable snapshots of the policy used then.
 */
export const MVP_USAGE_BILLING_ENABLED = true;

/**
 * Returns the charge that may be added to a newly generated invoice for
 * metered usage. Usage is still measured for quota and reconciliation.
 */
export function usageFeeForNewBillingGeneration(calculatedUsageFeeCents: number) {
  return MVP_USAGE_BILLING_ENABLED ? Math.max(0, calculatedUsageFeeCents) : 0;
}
