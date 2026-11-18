-- Q-11: switch off every `webinar_attended_duration_gte` automation rule that
-- is still marked active, as 20261118090100 did for `viewer_watch_progress`.
--
-- Until this release no code path ever ran a `webinar_attended_duration_gte`
-- rule (it had no caller; #599 showed such rules as "此觸發條件目前不會執行"
-- without switching them off). Rules stored before then carry the old
-- watch-seconds condition (`watch_seconds_gte`, or the 「高意向追單漏斗」
-- recipe's `watch_seconds_gte_and_not_purchased`), which this release does not
-- run: the watch pass only runs rules with a whole-minute threshold
-- (`watch_minutes_gte`). Keeping today's behaviour (nothing runs) is the safe
-- default, and the merchant creates a minutes rule in /settings/automations
-- when they want one. Such a legacy rule cannot be switched on again
-- (`condition_unsupported`), only switched off or deleted.
--
-- Forward-only data change on "AutomationRule" only: row locks on the matched
-- rows, no schema change. A `webinar_attended_duration_gte` rule never has
-- delayed-step runs (the trigger was never in DELAYED_STEP_AUTOMATION_TRIGGERS
-- before this release), so no DelayedStepRun needs stopping. Rules that are
-- already inactive and rules on any other trigger are not touched; a rerun
-- changes nothing.
DO $$
BEGIN
  PERFORM pg_catalog.set_config('lock_timeout', '5s', true);
END
$$;

UPDATE "AutomationRule"
   SET "isActive" = false,
       "updatedAt" = CURRENT_TIMESTAMP
 WHERE "trigger" = 'webinar_attended_duration_gte'
   AND "isActive" = true;
