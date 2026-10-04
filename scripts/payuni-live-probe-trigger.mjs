import { setTimeout as sleep } from "node:timers/promises";

const rawUrl = process.env.PAYUNI_LIVE_PROBE_URL;
const secret = process.env.PAYUNI_LIVE_PROBE_JOB_SECRET;
const expectedHost = process.env.PAYUNI_LIVE_PROBE_HOST;
if (!rawUrl || !secret || !expectedHost) throw new Error("Live probe runner configuration is missing.");
const target = new URL(rawUrl);
if (target.protocol !== "https:" || target.pathname !== "/api/jobs/payuni-live-probe"
  || target.search || target.hash || target.username || target.password || target.host !== expectedHost) {
  throw new Error("Live probe runner target is invalid.");
}

// Start only after the first signed setup receipt. The server owns the dueAt
// timestamp and is the sole authority for whether the second charge may run.
const singleCheck = process.env.PAYUNI_LIVE_PROBE_ONCE === "true";
for (let attempt = 0; attempt < (singleCheck ? 1 : 35); attempt += 1) {
  const response = await fetch(target, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}` },
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Live probe job returned HTTP ${response.status}.`);
  const { outcome } = await response.json();
  if (outcome === "not_due") {
    if (singleCheck) process.exit(0);
    await sleep(60_000);
    continue;
  }
  if (outcome === "confirmed") {
    process.stdout.write("One-time live probe confirmed.\n");
    process.exit(0);
  }
  throw new Error(`One-time live probe ended with ${String(outcome).slice(0, 40)}.`);
}
throw new Error("One-time live probe did not become due within the runner window.");
