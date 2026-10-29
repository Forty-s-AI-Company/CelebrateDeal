#!/usr/bin/env bash
# Starts the scheduled-jobs-heartbeat workflow unless another run of it is
# already queued, waiting or in progress. Shared by the heartbeat itself (to
# start its successor) and by scheduled-jobs.yml (to self-heal after an outage).
#
# Needs: GH_TOKEN with `actions: write`, GH_REPO (owner/name).
# Optional: HEARTBEAT_EXCLUDE_RUN_ID (the calling heartbeat run, so it does not
# count itself), HEARTBEAT_REF (default master).
set -uo pipefail

WORKFLOW="scheduled-jobs-heartbeat.yml"
REF="${HEARTBEAT_REF:-master}"
EXCLUDE="${HEARTBEAT_EXCLUDE_RUN_ID:-}"

if [ -z "${GH_TOKEN:-}" ] || [ -z "${GH_REPO:-}" ]; then
  echo "::error::GH_TOKEN and GH_REPO are required to start the heartbeat"
  exit 1
fi

# A disabled workflow must stay stopped: never start it again (or fail trying).
if state="$(gh api "repos/${GH_REPO}/actions/workflows/${WORKFLOW}" --jq .state 2>/dev/null)" && [ "$state" != "active" ]; then
  echo "heartbeat-ensure: workflow state is '${state}', not starting a heartbeat"
  exit 0
fi

if ! active="$(gh run list --workflow "$WORKFLOW" --limit 30 --json databaseId,status \
  --jq "[.[] | select(.status != \"completed\" and (.databaseId | tostring) != \"${EXCLUDE}\")] | length")"; then
  echo "::error::Could not list heartbeat runs (check the token and its actions permission)"
  exit 1
fi

if [ "$active" != "0" ]; then
  echo "heartbeat-ensure: ${active} heartbeat run(s) already active, nothing to start"
  exit 0
fi

if ! gh workflow run "$WORKFLOW" --ref "$REF"; then
  echo "::error::Could not dispatch ${WORKFLOW} on ${REF} (is the workflow disabled or the token missing actions: write?)"
  exit 1
fi
echo "heartbeat-ensure: dispatched ${WORKFLOW} on ${REF}"
