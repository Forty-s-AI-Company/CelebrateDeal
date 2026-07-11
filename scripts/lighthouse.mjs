import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { launch } from "chrome-launcher";
import lighthouse from "lighthouse";

const root = process.cwd();
const reportDir = path.join(root, "reports", "lighthouse");

function findAvailablePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (!address || typeof address === "string") {
        probe.close();
        reject(new Error("Unable to allocate a Lighthouse port."));
        return;
      }
      probe.close(() => resolve(address.port));
    });
  });
}

async function waitForServer(target, server, readServerError) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`Next.js production server exited before readiness. ${readServerError()}`.trim());
    }
    try {
      const response = await fetch(target, { redirect: "manual" });
      if (response.status < 500) return;
    } catch {
      // The production server may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Next.js server did not become ready: ${target}`);
}

async function main() {
  await readFile(path.join(root, ".next", "BUILD_ID"), "utf8").catch(() => {
    throw new Error("Run `npm run build` before `npm run lighthouse`.");
  });
  await mkdir(reportDir, { recursive: true });
  const requestedPort = process.env.LIGHTHOUSE_PORT
    ? Number(process.env.LIGHTHOUSE_PORT)
    : await findAvailablePort();
  if (!Number.isInteger(requestedPort) || requestedPort < 1024 || requestedPort > 65535) {
    throw new Error(`Invalid LIGHTHOUSE_PORT: ${process.env.LIGHTHOUSE_PORT}`);
  }
  const port = requestedPort;
  const url = `http://127.0.0.1:${port}/login`;
  const chromeProfileDir = path.join(reportDir, `chrome-profile-${process.pid}`);
  await mkdir(chromeProfileDir, { recursive: true });

  const server = spawn(
    process.execPath,
    [path.join(root, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(port)],
    { cwd: root, env: { ...process.env, NEXT_PUBLIC_APP_URL: `http://127.0.0.1:${port}` }, windowsHide: true },
  );
  let serverError = "";
  server.stderr?.on("data", (chunk) => {
    serverError = `${serverError}${String(chunk)}`.slice(-4000);
  });

  let chrome;
  try {
    await waitForServer(url, server, () => serverError);
    chrome = await launch({
      chromeFlags: ["--headless", "--no-sandbox"],
      userDataDir: chromeProfileDir,
    });
    const result = await lighthouse(url, {
      port: chrome.port,
      output: ["html", "json"],
      logLevel: "error",
      onlyCategories: ["performance", "accessibility", "best-practices", "seo"],
    });
    if (!result) throw new Error("Lighthouse returned no result.");

    const reports = Array.isArray(result.report) ? result.report : [result.report];
    await writeFile(path.join(reportDir, "report.html"), reports[0] ?? "", "utf8");
    await writeFile(path.join(reportDir, "report.json"), reports[1] ?? "", "utf8");

    const scores = Object.fromEntries(
      Object.entries(result.lhr.categories).map(([key, category]) => [key, category.score]),
    );
    console.log(JSON.stringify({ url, scores, reportDir }, null, 2));

    if ((scores.accessibility ?? 0) < 0.9 || (scores["best-practices"] ?? 0) < 0.9) {
      process.exitCode = 1;
    }
  } finally {
    if (chrome) {
      try {
        await chrome.kill();
      } catch (error) {
        console.warn(`Chrome cleanup warning: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    server.kill();
    await new Promise((resolve) => setTimeout(resolve, 250));
    await rm(chromeProfileDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 }).catch((error) => {
      console.warn(`Chrome profile cleanup warning: ${error instanceof Error ? error.message : String(error)}`);
    });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
