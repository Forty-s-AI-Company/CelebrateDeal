-- F-4 PR 3 (review MAJOR-1): switch off every `payment_paid` automation rule
-- that is still marked active.
--
-- Until this release no code path ever ran a `payment_paid` rule: it had no
-- caller, and #599 (F-4 PR 1) hid the trigger and showed such rules as
-- "此觸發條件目前不會執行" without switching them off. This release wires the
-- trigger into the payment webhook, so a rule left active would start mailing
-- buyers and issuing vouchers on the next paid order without the merchant ever
-- having seen it run. Keeping today's behaviour (nothing runs) is the safe
-- default: the merchant switches a rule back on in /settings/automations when
-- they want it.
--
-- Forward-only data change on "AutomationRule" only: row locks on the matched
-- rows, no schema change. A `payment_paid` rule never has delayed-step runs
-- (none could be created while the trigger was hidden, and this release
-- refuses its steps), so no DelayedStepRun needs stopping. Rules that are
-- already inactive and rules on any other trigger are not touched.
DO $$
BEGIN
  PERFORM pg_catalog.set_config('lock_timeout', '5s', true);
END
$$;

UPDATE "AutomationRule"
   SET "isActive" = false,
       "updatedAt" = CURRENT_TIMESTAMP
 WHERE "trigger" = 'payment_paid'
   AND "isActive" = true;
