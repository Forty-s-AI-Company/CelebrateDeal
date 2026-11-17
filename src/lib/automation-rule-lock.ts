import { captureOperationalError } from "@/lib/monitoring";
import { isLockTimeout, isLockWaitGivenUp } from "@/lib/serializable-retry";

/**
 * Called once in the busy branch of a rule write (isRuleWriteBusy). A plain
 * lock_timeout (55P03) or a transaction timeout (P2028) is the expected
 * outcome of a held rule and is not reported. A cancelled statement (57014)
 * still answers "busy" (PostgreSQL also reports a lock_timeout that way), but
 * it can also be a statement_timeout or an operator's pg_cancel_backend, so it
 * is reported as a warning instead of disappearing. Only the safe keys
 * `source` and `operation` reach monitoring; no ids or messages.
 */
export function reportCancelledRuleLockWait(error: unknown) {
  if (!isLockWaitGivenUp(error) || isLockTimeout(error)) return;
  captureOperationalError(error, { source: "automation_rule_write", operation: "lock_wait_cancelled" }, { level: "warning" });
}
