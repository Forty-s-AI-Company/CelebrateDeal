#!/usr/bin/env bash
# Heartbeat loop for .github/workflows/scheduled-jobs-heartbeat.yml.
#
# GitHub's `*/5` schedule fires only every few hours, so one long-lived job calls
# the frequent background jobs every HEARTBEAT_INTERVAL_SECONDS instead. Each call
# goes through scripts/scheduled-jobs-runner.mjs, the same runner (same secret,
# same output contract, same exit code) that scheduled-jobs.yml uses.
#
# A failing call is logged with ::error and never stops the loop; the script exits
# 1 at the end if any call failed, so the run is marked red like scheduled-jobs.yml.
# Near the end it asks scripts/scheduled-jobs-ensure-heartbeat.sh to queue the
# successor run (the workflow's concurrency group keeps it from starting early).
#
# Env: HEARTBEAT_JOBS (space separated job names, required), JOB_SECRET, GH_TOKEN,
#      GH_REPO, GITHUB_RUN_ID, HEARTBEAT_DURATION_SECONDS (default 20400 = 5h40m),
#      HEARTBEAT_INTERVAL_SECONDS (default 300).
set -uo pipefail

JOBS="${HEARTBEAT_JOBS:-}"
DURATION="${HEARTBEAT_DURATION_SECONDS:-20400}"
INTERVAL="${HEARTBEAT_INTERVAL_SECONDS:-300}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -z "$JOBS" ]; then
  echo "::error::HEARTBEAT_JOBS is empty"
  exit 1
fi
if [ -z "${JOB_SECRET:-}" ]; then
  echo "::error::JOB_SECRET is not available to the heartbeat"
  exit 1
fi
if [ -z "${GH_TOKEN:-}" ] || [ -z "${GH_REPO:-}" ]; then
  echo "::error::GH_TOKEN/GH_REPO missing; the heartbeat could not start its successor"
  exit 1
fi
# Fail fast on a bad token instead of discovering it 5h40m later.
if ! gh workflow view scheduled-jobs-heartbeat.yml >/dev/null; then
  echo "::error::The token cannot read the heartbeat workflow"
  exit 1
fi

# Tells the workflow it may safely start a successor if this step dies later; a
# configuration failure above must not respawn itself in a tight loop.
if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "preflight=ok" >> "$GITHUB_OUTPUT"; fi

start=$SECONDS
tick=0
failures=0
successor_requested=0

while :; do
  tick=$((tick + 1))
  elapsed=$((SECONDS - start))

  if [ "$successor_requested" = "0" ] && [ $((elapsed + INTERVAL)) -ge "$DURATION" ]; then
    successor_requested=1
    HEARTBEAT_EXCLUDE_RUN_ID="${GITHUB_RUN_ID:-}" bash "$HERE/scheduled-jobs-ensure-heartbeat.sh" || failures=$((failures + 1))
  fi

  echo "heartbeat tick=${tick} elapsed=${elapsed}s"
  pids=()
  names=()
  for job in $JOBS; do
    node "$HERE/scheduled-jobs-runner.mjs" "$job" &
    pids+=("$!")
    names+=("$job")
  done
  for i in "${!pids[@]}"; do
    if ! wait "${pids[$i]}"; then
      echo "::error::heartbeat tick ${tick}: scheduled job ${names[$i]} did not return 2xx"
      failures=$((failures + 1))
    fi
  done

  next=$((start + tick * INTERVAL))
  if [ "$next" -ge $((start + DURATION)) ]; then
    break
  fi
  wait_for=$((next - SECONDS))
  if [ "$wait_for" -gt 0 ]; then sleep "$wait_for"; fi
done

echo "heartbeat finished: ticks=${tick} failures=${failures}"
if [ "$failures" -gt 0 ]; then
  echo "::error::${failures} heartbeat call(s) failed. See the scheduled-job lines above."
  exit 1
fi
