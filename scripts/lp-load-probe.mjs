// F-015 / B05-04 / B06-04: local load probe for the public `/lp/*` funnel page.
//
// Measures one production-mode `next start` on loopback against a disposable
// PostgreSQL database seeded with synthetic data only:
//   - latency p50/p95/p99 and throughput at a fixed concurrency (default 100),
//   - database statements per request, counted from Prisma's query log
//     (`CELEBRATEDEAL_PRISMA_QUERY_LOG=stdout`, see src/lib/db.ts),
//   - the HTTP status of the anonymous availability contract cases.
//
// Usage (DATABASE_URL must be a loopback celebratedeal_* test database):
//   node --import tsx scripts/lp-load-probe.mjs [--build] [--port 31043]
//     [--concurrency 100] [--requests 2000] [--label name] [--out file.json]
//
// The server and the optional build run with an explicit synthetic
// environment: no shell secret, Sentry DSN, R2 or email credential is passed
// through, and nothing outside 127.0.0.1 is contacted.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { Prisma, PrismaClient } from "@prisma/client";
import { assertLocalTestDatabase } from "./local-database-safety.ts";
import { createLandingPageFixture } from "../tests/fixtures/landing-page.ts";
import { createFunnelFlow } from "../src/lib/funnel-flow.ts";
import { createFunnelStepPages } from "../src/lib/funnel-step-pages.ts";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const QUERY_LINE = /^prisma:query /u;

export function parseArguments(argv) {
  const options = { build: false, port: 31043, concurrency: 100, requests: 2000, sequential: 30, label: "probe", out: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (value === undefined) throw new Error(`Missing value for ${argument}`);
      index += 1;
      return value;
    };
    if (argument === "--build") options.build = true;
    else if (argument === "--port") options.port = Number(next());
    else if (argument === "--concurrency") options.concurrency = Number(next());
    else if (argument === "--requests") options.requests = Number(next());
    else if (argument === "--sequential") options.sequential = Number(next());
    else if (argument === "--label") options.label = next();
    else if (argument === "--out") options.out = next();
    else throw new Error(`Unknown argument ${argument}`);
  }
  for (const key of ["port", "concurrency", "requests", "sequential"]) {
    if (!Number.isInteger(options[key]) || options[key] < 1) throw new Error(`--${key} must be a positive integer`);
  }
  if (options.concurrency > 500 || options.requests > 50_000) throw new Error("Probe size is capped at 500 concurrency / 50,000 requests");
  return options;
}

/** Nearest-rank percentile of an ascending array (milliseconds). */
export function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil((p / 100) * sorted.length)));
  return Number(sorted[rank - 1].toFixed(1));
}

export function summarizeLatencies(latencies) {
  const sorted = [...latencies].sort((a, b) => a - b);
  return { p50: percentile(sorted, 50), p95: percentile(sorted, 95), p99: percentile(sorted, 99), max: sorted.length ? Number(sorted[sorted.length - 1].toFixed(1)) : null };
}

/** Synthetic-only environment for the build and the server process. */
export function syntheticEnvironment(databaseUrl, port) {
  const baseUrl = `http://127.0.0.1:${port}`;
  const inherited = {};
  for (const name of ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "TEMP", "TMP", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "ComSpec", "PATHEXT"]) {
    if (process.env[name] !== undefined) inherited[name] = process.env[name];
  }
  return {
    ...inherited,
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    DATABASE_URL: databaseUrl,
    DIRECT_URL: databaseUrl,
    NEXT_PUBLIC_APP_URL: baseUrl,
    E2E_TEST_MODE: "true",
    E2E_BASE_URL: baseUrl,
    PAYMENT_PROVIDER: "demo",
    RATE_LIMIT_PROVIDER: "memory",
    JOB_SECRET: "lp-load-probe-job-secret-synthetic-only",
    CSRF_SECRET: "lp-load-probe-csrf-secret-synthetic-only-v1",
    CRON_SECRET: "lp-load-probe-cron-secret-synthetic-only-v1",
    BANK_ACCOUNT_KEYRING_JSON: JSON.stringify({ activeKeyId: "synthetic", keys: { synthetic: Buffer.alloc(32, 17).toString("base64url") } }),
    SENTRY_DSN: "",
    NEXT_PUBLIC_SENTRY_DSN: "",
    SENTRY_AUTH_TOKEN: "",
    SENTRY_DISABLE_AUTO_UPLOAD: "true",
    CELEBRATEDEAL_PRISMA_QUERY_LOG: "stdout",
  };
}

function nextBin() {
  return path.join(repositoryRoot, "node_modules", "next", "dist", "bin", "next");
}

function runBuild(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [nextBin(), "build", "--webpack"], { cwd: repositoryRoot, env, stdio: ["ignore", "inherit", "inherit"] });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`next build exited with ${code}`))));
  });
}

function startServer(env, port) {
  const child = spawn(process.execPath, [nextBin(), "start", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: repositoryRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const state = { child, queries: 0, errors: [] };
  let buffered = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffered += chunk;
    const lines = buffered.split(/\r?\n/u);
    buffered = lines.pop() ?? "";
    for (const line of lines) if (QUERY_LINE.test(line)) state.queries += 1;
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    if (state.errors.length < 20) state.errors.push(String(chunk).slice(0, 300));
  });
  return state;
}

async function waitForServer(baseUrl, pathname, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}${pathname}`, { redirect: "manual" });
      await response.arrayBuffer();
      if (response.status < 500) return;
    } catch {
      // Server not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("next start did not become ready in time");
}

async function timedGet(url) {
  const started = performance.now();
  const response = await fetch(url, { redirect: "manual" });
  await response.arrayBuffer();
  return { status: response.status, ms: performance.now() - started };
}

async function seed(db) {
  const runKey = randomUUID();
  const suffix = runKey.replace(/-/gu, "").slice(-12).toLowerCase();
  const fixture = await createLandingPageFixture(db, `lp-probe-${runKey}`);
  const publish = async (slug, content, formId) => {
    const page = await db.landingPage.create({
      data: { vendorId: fixture.vendor.id, projectId: fixture.project.id, name: `TEST ONLY ${slug}`, slug, draftContent: content },
      select: { id: true },
    });
    const version = await db.landingPageVersion.create({
      data: { vendorId: fixture.vendor.id, pageId: page.id, version: 1, content, formId },
      select: { id: true },
    });
    await db.landingPage.update({ where: { id: page.id }, data: { status: "published", publishedVersionId: version.id, publishedAt: new Date() } });
    return page.id;
  };
  const funnelSlug = `test-only-lp-probe-funnel-${suffix}`;
  const legacySlug = `test-only-lp-probe-legacy-${suffix}`;
  const funnel = createFunnelStepPages(createFunnelFlow({ id: `flow_${suffix}`, name: "TEST ONLY 名單", goal: "audience", domain: funnelSlug }));
  const funnelPageId = await publish(funnelSlug, funnel, null);
  await publish(legacySlug, { schemaVersion: 1, data: { root: {}, content: [] } }, fixture.form.id);
  return { fixture, funnelSlug, funnelPageId, legacySlug, missingSlug: `test-only-lp-probe-missing-${suffix}` };
}

async function cleanup(db, seeded) {
  try {
    await db.vendor.delete({ where: { id: seeded.fixture.vendor.id } });
    await db.user.deleteMany({ where: { id: seeded.fixture.owner.id } });
  } catch (error) {
    console.error(`[lp-load-probe] cleanup left synthetic rows: ${error instanceof Error ? error.name : "error"}`);
  }
}

async function contractStatuses(db, baseUrl, seeded) {
  const status = async (pathname, method = "GET") => {
    const response = await fetch(`${baseUrl}${pathname}`, { method, redirect: "manual" });
    const body = method === "HEAD" ? "" : await response.text();
    return {
      status: response.status,
      cacheControl: response.headers.get("cache-control"),
      robotsHeader: response.headers.get("x-robots-tag"),
      noindexMeta: /noindex/u.test(body),
      // The requested slug may echo back in the RSC payload; a merchant reason must not.
      echoesRequestedSlug: body.includes("test-only-lp-probe"),
      merchantReason: /專案尚未發布|form_unavailable|live_unavailable|version_mismatch/u.test(body),
    };
  };
  const results = {
    funnelRoot: await status(`/lp/${seeded.funnelSlug}`),
    legacyRoot: await status(`/lp/${seeded.legacySlug}`),
    legacyHead: await status(`/lp/${seeded.legacySlug}`, "HEAD"),
    missingSlug: await status(`/lp/${seeded.missingSlug}`),
    missingStep: await status(`/lp/${seeded.funnelSlug}/no-such-step`),
  };
  await db.registrationForm.update({ where: { id: seeded.fixture.form.id }, data: { isActive: false } });
  try {
    results.legacyFormDisabled = await status(`/lp/${seeded.legacySlug}`);
  } finally {
    await db.registrationForm.update({ where: { id: seeded.fixture.form.id }, data: { isActive: true } });
  }
  await db.landingPage.update({ where: { id: seeded.funnelPageId }, data: { operations: { invalid: true } } });
  try {
    results.funnelInvalidOperations = await status(`/lp/${seeded.funnelSlug}`);
  } finally {
    await db.landingPage.update({ where: { id: seeded.funnelPageId }, data: { operations: Prisma.DbNull } });
  }
  await db.salesProject.update({ where: { id: seeded.fixture.project.id }, data: { status: "draft", publishedAt: null } });
  try {
    results.projectUnpublished = await status(`/lp/${seeded.funnelSlug}`);
  } finally {
    await db.salesProject.update({ where: { id: seeded.fixture.project.id }, data: { status: "published", publishedAt: new Date("2030-01-01T00:00:00.000Z") } });
  }
  return results;
}

async function sequentialQueries(server, url, count) {
  const before = server.queries;
  const latencies = [];
  for (let index = 0; index < count; index += 1) latencies.push((await timedGet(url)).ms);
  // Let the last log lines flush from the child process.
  await new Promise((resolve) => setTimeout(resolve, 300));
  return { requests: count, queriesPerRequest: Number(((server.queries - before) / count).toFixed(2)), latencyMs: summarizeLatencies(latencies) };
}

async function concurrentLoad(server, url, concurrency, total) {
  const before = server.queries;
  const latencies = [];
  const statuses = {};
  let issued = 0;
  let failures = 0;
  const started = performance.now();
  const worker = async () => {
    while (issued < total) {
      issued += 1;
      try {
        const result = await timedGet(url);
        latencies.push(result.ms);
        statuses[result.status] = (statuses[result.status] ?? 0) + 1;
      } catch {
        failures += 1;
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  const elapsedSeconds = (performance.now() - started) / 1_000;
  await new Promise((resolve) => setTimeout(resolve, 500));
  return {
    concurrency,
    requests: total,
    failures,
    statuses,
    requestsPerSecond: Number((latencies.length / elapsedSeconds).toFixed(1)),
    queriesPerRequest: Number(((server.queries - before) / total).toFixed(2)),
    latencyMs: summarizeLatencies(latencies),
  };
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  const databaseUrl = process.env.DATABASE_URL;
  assertLocalTestDatabase("DATABASE_URL", databaseUrl);
  const env = syntheticEnvironment(databaseUrl, options.port);
  const baseUrl = `http://127.0.0.1:${options.port}`;
  if (options.build) await runBuild(env);

  const db = new PrismaClient({ datasourceUrl: databaseUrl });
  const seeded = await seed(db);
  const server = startServer(env, options.port);
  try {
    const target = `/lp/${seeded.funnelSlug}`;
    await waitForServer(baseUrl, target);
    for (let index = 0; index < 20; index += 1) await timedGet(`${baseUrl}${target}`);
    const sequential = {
      funnelRoot: await sequentialQueries(server, `${baseUrl}${target}`, options.sequential),
      legacyRootWithForm: await sequentialQueries(server, `${baseUrl}/lp/${seeded.legacySlug}`, options.sequential),
      missingSlug: await sequentialQueries(server, `${baseUrl}/lp/${seeded.missingSlug}`, options.sequential),
    };
    const load = await concurrentLoad(server, `${baseUrl}${target}`, options.concurrency, options.requests);
    const contract = await contractStatuses(db, baseUrl, seeded);
    const report = {
      label: options.label,
      measuredAt: new Date().toISOString(),
      node: process.version,
      platform: `${process.platform}-${process.arch}`,
      target: "/lp/<synthetic audience funnel root>",
      sequential,
      load,
      contract,
      serverStderrSample: server.errors.slice(0, 3),
    };
    const text = `${JSON.stringify(report, null, 2)}\n`;
    if (options.out) fs.writeFileSync(options.out, text);
    process.stdout.write(text);
    return report;
  } finally {
    server.child.kill();
    await cleanup(db, seeded);
    await db.$disconnect();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[lp-load-probe] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
