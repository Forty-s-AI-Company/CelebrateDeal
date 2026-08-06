import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const RELEASE_SCHEMA = "celebratedeal-local-release-readiness/v1";
const REQUIRED_ARTIFACT_FILES = Object.freeze([
  "BUILD_ID",
  "required-server-files.json",
  "server/app-paths-manifest.json",
]);
const REQUIRED_SOURCE_FILES = Object.freeze([
  "package.json",
  "next.config.ts",
  "vercel.json",
  "src/app/api/health/route.ts",
]);
const ENVIRONMENT_KEYS = Object.freeze([
  "DATABASE_URL",
  "DIRECT_URL",
  "NEXT_PUBLIC_APP_URL",
  "JOB_SECRET",
  "CSRF_SECRET",
  "PAYMENT_PROVIDER",
  "RATE_LIMIT_PROVIDER",
  "RESEND_API_KEY",
  "EMAIL_FROM",
  "SENTRY_DSN",
  "NEXT_PUBLIC_POSTHOG_KEY",
  "NEXT_PUBLIC_POSTHOG_HOST",
]);
const WP91_TEMP_MIRROR_NAME = "celebratedeal-wp91-release";

export class ReleaseReadinessError extends Error {
  constructor(code) {
    super(code);
    this.name = "ReleaseReadinessError";
    this.code = code;
  }
}

function failUnless(condition, code) {
  if (!condition) throw new ReleaseReadinessError(code);
}

function releasePath(root, candidate) {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(resolvedRoot, candidate);
  failUnless(resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}${sep}`), "RELEASE_PATH_ESCAPE");
  return resolvedCandidate;
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function isRegularFile(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function collectFiles(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (["cache", "trace", "trace-build", "node_modules", "diagnostics"].includes(entry.name)) continue;
    const child = releasePath(root, relative(root, join(current, entry.name)));
    if (entry.isDirectory()) {
      files.push(...await collectFiles(root, child));
    } else if (entry.isFile()) {
      files.push(child);
    } else {
      throw new ReleaseReadinessError("ARTIFACT_NON_REGULAR_ENTRY");
    }
  }
  return files;
}

export function environmentAvailability(source = process.env) {
  return Object.freeze(Object.fromEntries(
    ENVIRONMENT_KEYS.map((key) => [key, Boolean(String(source[key] ?? "").trim())]),
  ));
}

export async function validateReleaseSource(sourceRoot) {
  const root = resolve(sourceRoot);
  for (const file of REQUIRED_SOURCE_FILES) {
    failUnless(await isRegularFile(releasePath(root, file)), "RELEASE_SOURCE_FILE_MISSING");
  }

  let packageJson;
  let vercelJson;
  try {
    packageJson = JSON.parse(await readFile(releasePath(root, "package.json"), "utf8"));
    vercelJson = JSON.parse(await readFile(releasePath(root, "vercel.json"), "utf8"));
  } catch {
    throw new ReleaseReadinessError("RELEASE_CONFIG_INVALID_JSON");
  }
  failUnless(typeof packageJson?.scripts?.build === "string" && typeof packageJson?.scripts?.start === "string", "RELEASE_PACKAGE_SCRIPTS_INVALID");
  failUnless(vercelJson?.framework === "nextjs", "RELEASE_DEPLOYMENT_CONFIG_INVALID");
  return Object.freeze({
    sourceFiles: REQUIRED_SOURCE_FILES,
    packageScripts: ["build", "start"],
    deploymentFramework: "nextjs",
  });
}

export async function manifestForArtifact(artifactRoot) {
  const root = resolve(artifactRoot);
  for (const file of REQUIRED_ARTIFACT_FILES) {
    failUnless(await isRegularFile(releasePath(root, file)), "RELEASE_ARTIFACT_FILE_MISSING");
  }

  let serverFiles;
  try {
    serverFiles = JSON.parse(await readFile(releasePath(root, "required-server-files.json"), "utf8"));
  } catch {
    throw new ReleaseReadinessError("RELEASE_REQUIRED_FILES_INVALID_JSON");
  }
  failUnless(serverFiles?.version === 1 && Array.isArray(serverFiles?.files), "RELEASE_REQUIRED_FILES_INVALID");

  const files = await collectFiles(root);
  const entries = [];
  for (const file of files.sort()) {
    const content = await readFile(file);
    const normalizedPath = relative(root, file).split(sep).join("/");
    entries.push(Object.freeze({
      path: normalizedPath,
      bytes: content.byteLength,
      sha256: digest(content),
    }));
  }
  const normalized = JSON.stringify(entries);
  return Object.freeze({
    schema: RELEASE_SCHEMA,
    fileCount: entries.length,
    totalBytes: entries.reduce((total, entry) => total + entry.bytes, 0),
    checksum: digest(normalized),
    files: Object.freeze(entries),
  });
}

export async function verifyLocalRelease({ sourceRoot = process.cwd(), artifactRoot = join(sourceRoot, ".next"), environment = process.env, expectedChecksum } = {}) {
  const source = await validateReleaseSource(sourceRoot);
  const artifact = await manifestForArtifact(artifactRoot);
  if (expectedChecksum !== undefined) failUnless(expectedChecksum === artifact.checksum, "RELEASE_ARTIFACT_CHECKSUM_MISMATCH");
  return Object.freeze({
    schema: RELEASE_SCHEMA,
    status: "verified",
    source,
    artifact: {
      fileCount: artifact.fileCount,
      totalBytes: artifact.totalBytes,
      checksum: artifact.checksum,
    },
    environmentAvailability: environmentAvailability(environment),
  });
}

export async function rehearseRollback({ previousArtifactRoot, candidateArtifactRoot } = {}) {
  failUnless(candidateArtifactRoot, "ROLLBACK_ARTIFACT_REQUIRED");
  const candidate = await manifestForArtifact(candidateArtifactRoot);
  const root = await mkdtemp(join(tmpdir(), "celebratedeal-release-rollback-"));
  const activeMetadata = join(root, "active-release.json");
  try {
    let previousArtifact = "previous-local-artifact";
    let previous;
    if (previousArtifactRoot) {
      previous = await manifestForArtifact(previousArtifactRoot);
    } else {
      const fixture = join(root, "synthetic-previous-artifact");
      await mkdir(join(fixture, "server"), { recursive: true });
      await writeFile(join(fixture, "BUILD_ID"), "previous-local-fixture\n", { encoding: "utf8", flag: "wx" });
      await writeFile(join(fixture, "required-server-files.json"), JSON.stringify({ version: 1, files: ["BUILD_ID"] }), { encoding: "utf8", flag: "wx" });
      await writeFile(join(fixture, "server", "app-paths-manifest.json"), JSON.stringify({}), { encoding: "utf8", flag: "wx" });
      previous = await manifestForArtifact(fixture);
      previousArtifact = "synthetic-previous-local-fixture";
    }
    await writeFile(activeMetadata, JSON.stringify({ slot: "previous", checksum: previous.checksum }), { encoding: "utf8", flag: "wx" });
    try {
      await writeFile(activeMetadata, JSON.stringify({ slot: "candidate", checksum: candidate.checksum }), { encoding: "utf8", flag: "w" });
      // The failure is deliberately injected after the candidate metadata switch.
      throw new ReleaseReadinessError("CANDIDATE_ACTIVATION_INJECTED_FAILURE");
    } catch (error) {
      if (!(error instanceof ReleaseReadinessError) || error.code !== "CANDIDATE_ACTIVATION_INJECTED_FAILURE") throw error;
      await writeFile(activeMetadata, JSON.stringify({ slot: "previous", checksum: previous.checksum }), { encoding: "utf8", flag: "w" });
    }
    const recovered = JSON.parse(await readFile(activeMetadata, "utf8"));
    failUnless(recovered?.slot === "previous" && recovered?.checksum === previous.checksum, "ROLLBACK_RECOVERY_MISMATCH");
    return Object.freeze({
      schema: RELEASE_SCHEMA,
      status: "rollback-rehearsed",
      previousChecksum: previous.checksum,
      candidateChecksum: candidate.checksum,
      recoveredChecksum: recovered.checksum,
      injectedCandidateActivationFailure: true,
      previousArtifact,
    });
  } finally {
    failUnless(basename(root).startsWith("celebratedeal-release-rollback-"), "ROLLBACK_TEMP_PATH_INVALID");
    await rm(root, { recursive: true, force: true });
  }
}

export async function cleanupWp91TemporaryMirror({ workspaceRoot = process.cwd() } = {}) {
  const tempRoot = resolve(tmpdir());
  const mirror = releasePath(tempRoot, WP91_TEMP_MIRROR_NAME);
  failUnless(basename(mirror) === WP91_TEMP_MIRROR_NAME, "WP91_TEMP_MIRROR_NAME_INVALID");
  try {
    const mirrorInfo = await lstat(mirror);
    failUnless(mirrorInfo.isDirectory(), "WP91_TEMP_MIRROR_MISSING");
    const moduleLink = join(mirror, "node_modules");
    const linkInfo = await lstat(moduleLink);
    failUnless(linkInfo.isSymbolicLink(), "WP91_TEMP_MIRROR_NODE_MODULES_NOT_LINK");
    const [actualTarget, expectedTarget] = await Promise.all([
      realpath(moduleLink),
      realpath(join(resolve(workspaceRoot), "node_modules")),
    ]);
    failUnless(actualTarget.toLowerCase() === expectedTarget.toLowerCase(), "WP91_TEMP_MIRROR_LINK_TARGET_MISMATCH");
    await rm(mirror, { recursive: true, force: false });
    failUnless(!(await isRegularFile(mirror)) && !(await pathExists(mirror)), "WP91_TEMP_MIRROR_CLEANUP_FAILED");
    return Object.freeze({ status: "wp91-temp-cleaned", mirrorName: WP91_TEMP_MIRROR_NAME, nodeModulesTargetVerified: true });
  } catch (error) {
    if (error instanceof ReleaseReadinessError) throw error;
    throw new ReleaseReadinessError("WP91_TEMP_MIRROR_CLEANUP_FAILED");
  }
}

async function pathExists(path) {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

async function runCli() {
  const [command, artifactArgument, previousArgument] = process.argv.slice(2);
  try {
    if (command === "verify") {
      const result = await verifyLocalRelease({ artifactRoot: artifactArgument ? resolve(artifactArgument) : join(process.cwd(), ".next") });
      console.log(JSON.stringify(result));
      return;
    }
    if (command === "rehearse") {
      const result = await rehearseRollback({
        candidateArtifactRoot: artifactArgument ? resolve(artifactArgument) : join(process.cwd(), ".next"),
        previousArtifactRoot: previousArgument ? resolve(previousArgument) : undefined,
      });
      console.log(JSON.stringify(result));
      return;
    }
    if (command === "cleanup-wp91-temp") {
      console.log(JSON.stringify(await cleanupWp91TemporaryMirror()));
      return;
    }
    throw new ReleaseReadinessError("RELEASE_COMMAND_INVALID");
  } catch (error) {
    const code = error instanceof ReleaseReadinessError ? error.code : "RELEASE_UNEXPECTED_FAILURE";
    console.error(JSON.stringify({ schema: RELEASE_SCHEMA, status: "failed", code }));
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await runCli();
