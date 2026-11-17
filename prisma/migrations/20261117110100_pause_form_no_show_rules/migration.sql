-- Q-11: switch off every `form_no_show` automation rule that is still marked
-- active, as 20261114120000 did for `payment_paid`.
--
-- Until this release no code path ever ran a `form_no_show` rule: its only
-- dispatcher had no caller, and #599 (F-4 PR 1) hid the trigger and showed
-- such rules as "此觸發條件目前不會執行" without switching them off. This
-- release runs the trigger from the e-mail job for every session that ended in
-- the last 24 hours, so a rule left active would start mailing registrants
-- without the merchant ever having seen it run. Keeping today's behaviour
-- (nothing runs) is the safe default: the merchant switches a rule back on in
-- /settings/automations when they want it, and a rule switched on later never
-- runs for a session that ended before (its `updatedAt` moves).
--
-- Forward-only data change on "AutomationRule" only: row locks on the matched
-- rows, no schema change. A `form_no_show` rule never has delayed-step runs
-- (none could be created while the trigger was hidden), so no DelayedStepRun
-- needs stopping. Rules that are already inactive and rules on any other
-- trigger are not touched.
DO $$
BEGIN
  PERFORM pg_catalog.set_config('lock_timeout', '5s', true);
END
$$;

UPDATE "AutomationRule"
   SET "isActive" = false,
       "updatedAt" = CURRENT_TIMESTAMP
 WHERE "trigger" = 'form_no_show'
   AND "isActive" = true;
