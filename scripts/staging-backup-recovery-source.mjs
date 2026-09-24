import { fileURLToPath } from "node:url";
import path from "node:path";

const REPOSITORY = "Forty-s-AI-Company/CelebrateDeal";
const BACKUP_WORKFLOW = ".github/workflows/secure-staging-validation.yml";
// Launch blocker: #288 的此分支 SHA 尚非受保護 master 的 merge SHA；合併後須改 pin 實際 SHA。
const BACKUP_COMMIT = "d1fbc07ece9c827ee542cd7753460006653a9adf";
const SOURCE_SHA = "9193326824b8b6bf774bdfa28e4783a1a1b8f304";
const ARCHIVE_ARTIFACT = `secure-staging-encrypted-backup-${SOURCE_SHA}`;
const RECEIPT_ARTIFACT = `secure-staging-wp2-readonly-restore-${SOURCE_SHA}`;

export function validateRunId(value) {
  return typeof value === "string" && /^[1-9][0-9]{0,15}$/u.test(value) && Number.isSafeInteger(Number(value));
}

export function validateBackupRun(run, listing, requestedId) {
  if (!validateRunId(requestedId) || run?.id !== Number(requestedId)
    || run?.head_sha !== BACKUP_COMMIT || run?.head_branch !== "master"
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
    return validateBackupRun(run, artifacts, runId);
  } catch { return false; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const valid = await attestBackupRun(process.env.BACKUP_RUN_ID, process.env.GITHUB_TOKEN);
  process.stdout.write(`fixed_backup_run_attestation=${valid ? "PASS" : "BLOCKED"}\n`);
  if (!valid) process.exitCode = 2;
}

export const BACKUP_SOURCE = Object.freeze({ repository: REPOSITORY, workflow: BACKUP_WORKFLOW, backupCommit: BACKUP_COMMIT, sourceSha: SOURCE_SHA, archiveArtifact: ARCHIVE_ARTIFACT, receiptArtifact: RECEIPT_ARTIFACT });
