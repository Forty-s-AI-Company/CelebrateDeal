// F-156 post-build smoke (CI Build job, after `npm run build`):
// 1. zod stays out of the shared startup bundle (`rootMainFiles`), so it is
//    loaded only by the client components that validate input.
// 2. `next start` with CSP_ENFORCE=true serves /login, /register and a 404
//    page where every <script> carries the nonce of the response's enforced
//    Content-Security-Policy header.
// Runs against the existing `.next` output; it never builds, and the server
// only receives the environment of the calling CI step plus CSP_ENFORCE.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ZOD_SIGNATURE = /\$ZodObject|\$ZodType/u;
export const SMOKE_PATHS = ["/login", "/register", "/csp-smoke-not-found"];

export function rootMainZodChunks(projectRoot, read = (file) => readFileSync(file, "utf8")) {
  const manifest = JSON.parse(read(path.join(projectRoot, ".next", "build-manifest.json")));
  const files = manifest.rootMainFiles ?? [];
  if (!Array.isArray(files) || files.length === 0) throw new Error("build-manifest.json has no rootMainFiles");
  return files.filter((file) => ZOD_SIGNATURE.test(read(path.join(projectRoot, ".next", file))));
}

export function headerNonce(policy) {
  const scriptSrc = (policy ?? "").split(";").map((part) => part.trim()).find((part) => part.startsWith("script-src "));
  return scriptSrc?.match(/'nonce-([A-Za-z0-9+/]{22}==)'/u)?.[1] ?? null;
}

/** Problems with the document's scripts: each <script> tag must carry exactly the header nonce. */
export function scriptNonceProblems(html, nonce) {
  const problems = [];
  const tags = html.match(/<script\b[^>]*>/giu) ?? [];
  if (tags.length === 0) problems.push("no <script> tags");
  for (const tag of tags) {
    const value = tag.match(/\snonce="([^"]*)"/u)?.[1];
    if (value !== nonce) problems.push(`script without the response nonce: ${tag.slice(0, 120)}`);
  }
  return problems;
}

export async function checkDocument(baseUrl, pathname, fetchImpl = fetch) {
  const response = await fetchImpl(`${baseUrl}${pathname}`, { redirect: "manual" });
  const policy = response.headers.get("content-security-policy");
  const nonce = headerNonce(policy);
  const problems = [];
  if (!policy) problems.push("no enforced Content-Security-Policy header");
  else if (!nonce) problems.push("enforced policy has no script nonce");
  if (/script-src[^;]*'unsafe-(?:inline|eval)'/u.test(policy ?? "")) problems.push("script-src allows unsafe-inline or unsafe-eval");
  const html = await response.text();
  if (nonce) problems.push(...scriptNonceProblems(html, nonce));
  return { pathname, status: response.status, problems };
}

async function waitForServer(baseUrl, child, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`next start exited with ${child.exitCode}`);
    try {
      await fetch(`${baseUrl}/login`, { redirect: "manual" });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error("next start did not answer in time");
}

async function main() {
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const zodChunks = rootMainZodChunks(projectRoot);
  if (zodChunks.length > 0) throw new Error(`zod is in the shared startup bundle: ${zodChunks.join(", ")}`);
  console.log("[PASS] rootMainFiles do not contain zod");

  const port = Number(process.env.CSP_SMOKE_PORT ?? 31099);
  const baseUrl = `http://127.0.0.1:${port}`;
  const nextCli = path.join(projectRoot, "node_modules", "next", "dist", "bin", "next");
  const child = spawn(process.execPath, [nextCli, "start", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: projectRoot,
    env: { ...process.env, NODE_ENV: "production", CSP_ENFORCE: "true" },
    stdio: ["ignore", "ignore", "inherit"],
  });
  try {
    await waitForServer(baseUrl, child);
    let failed = false;
    for (const pathname of SMOKE_PATHS) {
      const result = await checkDocument(baseUrl, pathname);
      const ok = result.problems.length === 0;
      failed ||= !ok;
      console.log(`[${ok ? "PASS" : "FAIL"}] ${pathname} (${result.status})${ok ? "" : `: ${result.problems.join("; ")}`}`);
    }
    if (failed) process.exitCode = 1;
  } finally {
    child.kill();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[FAIL] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
