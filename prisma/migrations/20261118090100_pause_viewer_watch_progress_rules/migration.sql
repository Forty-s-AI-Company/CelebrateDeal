-- Q-11: switch off every `viewer_watch_progress` automation rule that is still
-- marked active, as 20261117110100 did for `form_no_show`.
--
-- Until this release no code path ever ran a `viewer_watch_progress` rule
-- (#599 hid the trigger and showed such rules as "此觸發條件目前不會執行"
-- without switching them off). Rules stored before then carry the old
-- watch-seconds condition, which this release does not run; the new watch
-- progress pass only runs rules with a percentage threshold. Keeping today's
-- behaviour (nothing runs) is the safe default, and the merchant creates a
-- percentage rule in /settings/automations when they want one. A rule switched
-- on later never runs for viewing credited before (its `updatedAt` moves).
--
-- Forward-only data change on "AutomationRule" only: row locks on the matched
-- rows, no schema change. A `viewer_watch_progress` rule never has
-- delayed-step runs (none could be created while the trigger was hidden), so
-- no DelayedStepRun needs stopping. Rules that are already inactive and rules
-- on any other trigger are not touched.
DO $$
BEGIN
  PERFORM pg_catalog.set_config('lock_timeout', '5s', true);
END
$$;

UPDATE "AutomationRule"
   SET "isActive" = false,
       "updatedAt" = CURRENT_TIMESTAMP
 WHERE "trigger" = 'viewer_watch_progress'
   AND "isActive" = true;
