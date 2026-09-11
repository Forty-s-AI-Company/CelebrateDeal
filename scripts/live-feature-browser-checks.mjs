import crypto from "node:crypto";
import dgram from "node:dgram";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildIsolatedEnvironment } from "./private-chat-disposable-qa.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const evidenceRoot = path.join(root, "docs/live-feature-handoffs");
const cases = [
  ["private-chat-browser-qa.mjs", "private-chat-browser-evidence.json"],
  ["interaction-card-browser-qa.mjs", "interaction-card-browser-evidence.json"],
  ["interaction-timeline-browser-qa.mjs", "interaction-timeline-browser-evidence.json"],
  ["mobile-viewing-browser-qa.mjs", "orientation-mobile-browser-evidence.json"],
  ["danmaku-browser-qa.mjs", "danmaku-browser-evidence.json"],
  ["scripted-roles-browser-qa.mjs", "scripted-roles-browser-evidence.json"],
  ["presenter-browser-qa.mjs", "presenter-browser-evidence.json", true],
  ["orientation-broadcast-qa.mjs", "orientation-broadcast-evidence.json", true],
  ["orientation-landscape-broadcast-qa.mjs", "orientation-landscape-broadcast-evidence.json", true],
  ["background-removal-browser-qa.mjs", "background-removal-browser-evidence.json", true],
];
const chromiumCases = new Set([3, 4, 6, 9]);
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

function parseArguments(args) {
  const selected = [];
  let chromium = false;
  let browserPath = null;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--chromium" && !chromium) chromium = true;
    else if (argument === "--browser-path" && browserPath === null) {
      browserPath = args[++index];
      if (!browserPath || !path.isAbsolute(browserPath)) throw new Error("BROWSER_PATH_MUST_BE_ABSOLUTE");
    } else if (/^[0-9]$/.test(argument) && !selected.includes(Number(argument))) selected.push(Number(argument));
    else throw new Error("EXPECTED_UNIQUE_CASE_INDICES_0_TO_9_AND_EXPLICIT_BROWSER_OPTIONS");
  }
  if (selected.length === 0) throw new Error("AT_LEAST_ONE_EXPLICIT_CASE_INDEX_REQUIRED");
  if (chromium !== (browserPath !== null)) throw new Error("CHROMIUM_REQUIRES_EXPLICIT_BROWSER_PATH_CACHE_DIRECTORY");
  if (chromium && selected.some((index) => !chromiumCases.has(index))) {
    throw new Error("CHROMIUM_OPTION_SUPPORTED_ONLY_BY_CASES_3_4_6_9");
  }
  return { selected, chromium, browserPath };
}

async function isolatedEnvironment(tempRoot, options) {
  const environment = buildIsolatedEnvironment(tempRoot);
  for (const key of ["TEMP", "TMP", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "DOCKER_CONFIG"]) {
    await fs.mkdir(environment[key], { recursive: true });
  }
  if (options.chromium) {
    environment.LIVE_QA_BROWSER_CHANNEL = "chromium";
    environment.PLAYWRIGHT_BROWSERS_PATH = options.browserPath;
  }
  return environment;
}

// Capture bounded diagnostics only; do not print browser launch logs or inherited configuration.
function run(executable, args, environment) {
  return new Promise((resolve) => {
    const child = spawn(executable, args, { cwd: root, env: environment, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout = (stdout + chunk).slice(-65_536);
      for (const line of String(chunk).split(/\r?\n/)) {
        if (/^Background soak: \d+ seconds$/.test(line)) console.log(line);
      }
    });
    child.stderr.on("data", () => {});
    child.once("error", () => resolve({ exitCode: null, signal: null, spawnFailed: true, stdout }));
    child.once("close", (exitCode, signal) => resolve({ exitCode, signal, spawnFailed: false, stdout }));
  });
}

function tcpPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}

function udpPortFree(port) {
  return new Promise((resolve) => {
    const socket = dgram.createSocket("udp4");
    socket.once("error", () => { socket.close(); resolve(false); });
    socket.bind(port, "127.0.0.1", () => socket.close(() => resolve(true)));
  });
}

async function mediaPortsFree() {
  return (await tcpPortFree(18889)) && (await tcpPortFree(18189)) && (await udpPortFree(18189));
}

async function verifyMediaArtifact(environment) {
  if (process.platform !== "win32") throw new Error("MEDIA_RUNNERS_REQUIRE_WINDOWS_EXECUTABLE");
  const receiptRelative = "docs/live-feature-handoffs/presenter-mediamtx-artifact.json";
  const artifact = JSON.parse(await fs.readFile(path.join(root, receiptRelative), "utf8"));
  if (!/^sha256:[a-f0-9]{64}$/.test(artifact.digest) || artifact.digest !== artifact.upstreamDigest) {
    throw new Error("MEDIA_ARTIFACT_RECEIPT_DIGEST_INVALID");
  }
  const archivePath = path.join(root, "tmp/presenter-media/mediamtx.zip");
  const binaryPath = path.join(root, "tmp/presenter-media/bin/mediamtx.exe");
  const archiveSha256 = sha256(await fs.readFile(archivePath));
  if (`sha256:${archiveSha256}` !== artifact.digest) throw new Error("MEDIA_ARCHIVE_DIGEST_MISMATCH");
  const binarySha256 = sha256(await fs.readFile(binaryPath));
  // Read only the executable ZIP member in memory using Windows' built-in ZIP reader.
  // PowerShell single-quoted literals escape apostrophes by doubling them.
  const command = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead('${archivePath.replaceAll("'", "''")}')
try {
  $entries = @($archive.Entries | Where-Object { $_.FullName -eq 'mediamtx.exe' })
  if ($entries.Count -ne 1) { throw 'MEDIA_ARCHIVE_MEMBER_INVALID' }
  $stream = $entries[0].Open()
  $hasher = [System.Security.Cryptography.SHA256]::Create()
  try { ([BitConverter]::ToString($hasher.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
  finally { $hasher.Dispose(); $stream.Dispose() }
} finally { $archive.Dispose() }
`;
  const result = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(command, "utf16le").toString("base64")], environment);
  const archiveMemberSha256 = result.stdout.trim();
  if (result.exitCode !== 0 || !/^[a-f0-9]{64}$/.test(archiveMemberSha256) || archiveMemberSha256 !== binarySha256) {
    throw new Error("MEDIA_BINARY_DOES_NOT_MATCH_VERIFIED_ARCHIVE");
  }
  return { status: "PASS", verifiedAt: new Date().toISOString(), trustAnchor: receiptRelative, archiveSha256, binarySha256, archiveMemberSha256, boundary: "actual local hashes matched an existing upstream digest receipt; no new upstream lookup" };
}

async function readFreshEvidence(filePath, startedAt, previousMtime) {
  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat || stat.mtimeMs < Date.parse(startedAt) || stat.mtimeMs === previousMtime) throw new Error("NO_FRESH_RECEIPT");
  const bytes = await fs.readFile(filePath);
  const evidence = JSON.parse(bytes);
  const checkCount = Array.isArray(evidence.checks) ? evidence.checks.length : 0;
  const pageErrorCount = Array.isArray(evidence.pageErrors) ? evidence.pageErrors.length : evidence.pageErrors ?? evidence.consoleErrors ?? null;
  return {
    evidence: path.relative(root, filePath).replaceAll("\\", "/"), evidenceSha256: sha256(bytes), freshEvidence: true,
    evidenceStatus: evidence.status, checkCount, checks: evidence.checks, boundary: evidence.boundary, pageErrorCount,
    failure: (evidence.failure ?? evidence.error)?.split("\n")[0] ?? null,
    evidencePassed: evidence.status === "PASS" && checkCount > 0 && (pageErrorCount === null || pageErrorCount === 0),
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.browserPath && !(await fs.stat(options.browserPath)).isDirectory()) throw new Error("BROWSER_PATH_MUST_BE_CACHE_DIRECTORY");
  await fs.mkdir(path.join(root, "tmp"), { recursive: true });
  // Serializes this entry point's writers; a stale lock requires explicit operator inspection.
  const lockPath = path.join(root, "tmp/live-feature-browser-checks.lock");
  const lock = await fs.open(lockPath, "wx");
  try {
    const tempRoot = await fs.mkdtemp(path.join(root, "tmp/live-feature-browser-checks-"));
    const runId = path.basename(tempRoot);
    const receiptDirectory = path.join(evidenceRoot, "browser-checks");
    await fs.mkdir(receiptDirectory, { recursive: true });
    const receiptPath = path.join(receiptDirectory, `${runId}.json`);
    const summary = { schemaVersion: 1, runId, startedAt: new Date().toISOString(), status: "RUNNING", selectedCases: options.selected, browserChannel: options.chromium ? "chromium" : "msedge", browserPath: options.browserPath, boundary: "isolated environment; loopback HTTP/media; synthetic API/auth/DB/media inputs; real browser/local worker; no Production or physical device validation", attempts: [] };
    const save = () => fs.writeFile(receiptPath, JSON.stringify(summary, null, 2) + "\n");
    await save();
    for (const caseIndex of options.selected) {
      const [scriptName, evidenceName, media] = cases[caseIndex];
      const scriptPath = path.join(root, "scripts", scriptName);
      const evidencePath = path.join(evidenceRoot, evidenceName);
      const previousMtime = (await fs.stat(evidencePath).catch(() => null))?.mtimeMs ?? null;
      const entry = { caseIndex, command: `node scripts/${scriptName}`, startedAt: new Date().toISOString(), status: "RUNNING", exitCode: null, freshEvidence: false };
      summary.attempts.push(entry);
      await save();
      try {
        const environment = await isolatedEnvironment(path.join(tempRoot, String(caseIndex)), options);
        // This legacy runner owns a separate nested browser environment.
        if (caseIndex === 3) await isolatedEnvironment(path.join(root, "tmp/mobile-viewing"), options);
        entry.scriptSha256 = sha256(await fs.readFile(scriptPath));
        if (media) {
          entry.mediaArtifact = await verifyMediaArtifact(environment);
          if (!(await mediaPortsFree())) throw new Error("MEDIA_PORT_OWNED_BY_ANOTHER_PROCESS");
        }
        console.log(`START ${scriptName} ${entry.startedAt}`);
        const { exitCode, signal, spawnFailed } = await run(process.execPath, [scriptPath], environment);
        Object.assign(entry, { exitCode, signal, spawnFailed });
        if (media) entry.mediaPortsReleased = await mediaPortsFree();
        Object.assign(entry, await readFreshEvidence(evidencePath, entry.startedAt, previousMtime));
        entry.status = exitCode === 0 && entry.evidencePassed && entry.mediaPortsReleased !== false ? "PASS" : "FAIL";
      } catch (error) {
        entry.status = "FAIL";
        entry.failure = error.message.split("\n")[0];
      }
      entry.finishedAt = new Date().toISOString();
      entry.durationMs = Date.parse(entry.finishedAt) - Date.parse(entry.startedAt);
      await save();
      console.log(JSON.stringify({ caseIndex, status: entry.status, exitCode: entry.exitCode, checkCount: entry.checkCount ?? 0, failure: entry.failure ?? null }));
    }
    summary.finishedAt = new Date().toISOString();
    summary.status = summary.attempts.every((entry) => entry.status === "PASS") ? "PASS" : "FAIL";
    summary.checkCount = summary.attempts.reduce((count, entry) => count + (entry.checkCount ?? 0), 0);
    await save();
    console.log(JSON.stringify({ status: summary.status, receipt: path.relative(root, receiptPath).replaceAll("\\", "/"), cases: summary.attempts.length, checks: summary.checkCount }));
    process.exitCode = summary.status === "PASS" ? 0 : 1;
  } finally {
    await lock.close();
    await fs.unlink(lockPath);
  }
}

await main().catch((error) => { console.error(`LIVE_FEATURE_BROWSER_CHECKS_FAILED: ${error.message.split("\n")[0]}`); process.exitCode = 1; });
