import { fileURLToPath } from "node:url";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPOSITORY = "Forty-s-AI-Company/CelebrateDeal";
const BACKUP_WORKFLOW = ".github/workflows/secure-staging-validation.yml";
const MINIMUM_BACKUP_COMMIT = "e13084f37edf9669f47c02351e646972201ae211";
const SOURCE_SHA = "9193326824b8b6bf774bdfa28e4783a1a1b8f304";
const ARCHIVE_ARTIFACT = `secure-staging-encrypted-backup-${SOURCE_SHA}`;
const RECEIPT_ARTIFACT = `secure-staging-wp2-readonly-restore-${SOURCE_SHA}`;
const SAFE_SHA = /^[a-f0-9]{40}$/u;
// Backup code must match an independently reviewed version. A fixed run SHA
// would become unusable as soon as the recovery workflow is merged to master.
const APPROVED_BACKUP_BLOBS = Object.freeze({
  [BACKUP_WORKFLOW]: ["3fb8088ae786e21dd520df8e9fc03788f355901d"],
  "scripts/staging-retained-backup.mjs": ["acf26bf628903feef3d549e4500b5c478e7e4312"],
  "scripts/validate-staging-retained-backup.mjs": ["8c1a8cdc551264b2121a9b075725eaa5770701e4"],
  "scripts/secure-staging-runner.mjs": [
    "50839ab6d2cf96b2c8a6a1d9870a9f29b2065555", // #288
    "8b14996eeca4e1616743fb6c168991287c626b28", // #290
  ],
});

export function validateRunId(value) {
  return typeof value === "string" && /^[1-9][0-9]{0,15}$/u.test(value) && Number.isSafeInteger(Number(value));
}

export function validateBackupRun(run, listing, requestedId) {
  if (!validateRunId(requestedId) || run?.id !== Number(requestedId)
    || !SAFE_SHA.test(run?.head_sha ?? "") || run?.head_branch !== "master"
    || run?.path !== BACKUP_WORKFLOW || run?.event !== "workflow_dispatch"
    || run?.status !== "completed" || run?.conclusion !== "success"
    || run?.repository?.full_name !== REPOSITORY || run?.head_repository?.full_name !== REPOSITORY) return false;
  if (run.inputs?.task !== undefined && run.inputs.task !== "wp2-readonly-restore") return false;
  if (run.inputs?.source_sha !== undefined && run.inputs.source_sha !== SOURCE_SHA) return false;
  if (run.inputs?.deployment_host !== undefined && !/^[a-z0-9-]+\.vercel\.app$/u.test(run.inputs.deployment_host)) return false;
  if (!Array.isArray(listing?.artifacts) || listing.total_count !== listing.artifacts.length || listing.artifacts.length > 100) return false;
  for (const name of [ARCHIVE_ARTIFACT, RECEIPT_ARTIFACT]) {
    const matches = listing.artifacts.filter((artifact) => artifact?.name === name);
    if (matches.length !== 1 || matches[0].expired !== false || matches[0].workflow_run?.id !== run.id
      || !Number.isSafeInteger(matches[0].size_in_bytes) || matches[0].size_in_bytes <= 0) return false;
  }
  return true;
}

export function verifyBackupSource(headSha, spawnImpl = spawnSync) {
  if (!SAFE_SHA.test(headSha ?? "")) return false;
  const execute = (args) => {
    const child = spawnImpl("git", args, {
      cwd: ROOT,
      env: Object.fromEntries(["PATH", "HOME", "SystemRoot", "USERPROFILE"].filter((key) => typeof process.env[key] === "string").map((key) => [key, process.env[key]])),
      encoding: "utf8", shell: false, windowsHide: true, timeout: 10_000, maxBuffer: 1024,
    });
    return { code: child.status ?? 1, stdout: String(child.stdout ?? "").trim() };
  };
  if (execute(["merge-base", "--is-ancestor", MINIMUM_BACKUP_COMMIT, headSha]).code !== 0
    || execute(["merge-base", "--is-ancestor", headSha, "HEAD"]).code !== 0) return false;
  for (const [file, approved] of Object.entries(APPROVED_BACKUP_BLOBS)) {
    const result = execute(["rev-parse", `${headSha}:${file}`]);
    if (result.code !== 0 || !approved.includes(result.stdout)) return false;
  }
  return true;
}

export async function attestBackupRun(runId, token, fetchImpl = fetch) {
  if (!validateRunId(runId) || typeof token !== "string" || token.length === 0) return false;
  const request = async (url) => {
    const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" }, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error("BACKUP_RUN_API_FAILED");
    return response.json();
  };
  try {
    const root = `https://api.github.com/repos/${REPOSITORY}/actions/runs/${runId}`;
    const run = await request(root);
    const artifacts = await request(`${root}/artifacts?per_page=100`);
    return validateBackupRun(run, artifacts, runId) && verifyBackupSource(run.head_sha);
  } catch { return false; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const valid = await attestBackupRun(process.env.BACKUP_RUN_ID, process.env.GITHUB_TOKEN);
  process.stdout.write(`fixed_backup_run_attestation=${valid ? "PASS" : "BLOCKED"}\n`);
  if (!valid) process.exitCode = 2;
}

export const BACKUP_SOURCE = Object.freeze({ repository: REPOSITORY, workflow: BACKUP_WORKFLOW, minimumBackupCommit: MINIMUM_BACKUP_COMMIT, sourceSha: SOURCE_SHA, archiveArtifact: ARCHIVE_ARTIFACT, receiptArtifact: RECEIPT_ARTIFACT });
