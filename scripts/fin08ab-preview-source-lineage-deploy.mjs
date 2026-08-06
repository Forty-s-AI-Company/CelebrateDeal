import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const WORK_PACKAGE = "FIN-08AB";
export const SAFE_ENV_NAMES = [
  "PATH",
  "PATHEXT",
  "SYSTEMROOT",
  "WINDIR",
  "TEMP",
  "TMP",
  "USERPROFILE",
  "LOCALAPPDATA",
  "APPDATA",
  "CI",
];

export function buildChildEnvironment(parent = process.env) {
  const env = {};
  for (const name of SAFE_ENV_NAMES) {
    if (typeof parent[name] === "string") env[name] = parent[name];
  }
  env.CI = "1";
  return env;
}

export function buildPreviewDeployArgs() {
  return ["deploy", "--yes", "--skip-domain", "--no-color"];
}

export function locateVercelCli(root = process.cwd()) {
  const candidates = [
    "C:\\nvm4w\\nodejs\\node_modules\\vercel\\dist\\index.js",
    path.join(root, "node_modules", "vercel", "dist", "index.js"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

export function buildReceipt(result, { cliPresent, projectLinked }) {
  const timedOut = result?.error?.code === "ETIMEDOUT";
  const exitCode = Number.isInteger(result?.status) ? result.status : null;
  return {
    workPackage: WORK_PACKAGE,
    status: cliPresent && projectLinked && exitCode === 0 && !timedOut
      ? "FIN08AB_PREVIEW_DEPLOY_PASS"
      : "FIN08AB_PREVIEW_DEPLOY_FAIL_CLOSED",
    exitCode,
    timedOut,
    cliPresent,
    projectLinked,
    stdoutPersisted: false,
    stderrPersisted: false,
    urlPersisted: false,
    deploymentIdPersisted: false,
    production: false,
    environmentMutation: false,
    aliasMutation: false,
    databaseOperations: 0,
    payuniOperations: 0,
  };
}

export function runPreviewDeploy({
  root = process.cwd(),
  cliPath = locateVercelCli(root),
  spawn = spawnSync,
  parentEnv = process.env,
} = {}) {
  const projectLinked = existsSync(path.join(root, ".vercel", "project.json"))
    || existsSync(path.join(root, ".vercel", "repo.json"));
  if (!cliPath || !projectLinked) {
    return buildReceipt({ status: null }, { cliPresent: Boolean(cliPath), projectLinked });
  }
  const result = spawn(process.execPath, [cliPath, ...buildPreviewDeployArgs()], {
    cwd: root,
    env: buildChildEnvironment(parentEnv),
    stdio: "ignore",
    windowsHide: true,
    timeout: 15 * 60 * 1000,
  });
  return buildReceipt(result, { cliPresent: true, projectLinked });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const receipt = runPreviewDeploy();
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
  process.exitCode = receipt.status === "FIN08AB_PREVIEW_DEPLOY_PASS" ? 0 : 1;
}
