import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// The mirror and its receipt use one config inventory so they cannot drift.
export const TEAM_VIDEO_MIRROR_CONFIG_FILES = [
  "package.json", "tsconfig.json", "next.config.ts", "postcss.config.mjs",
  "sentry.server.config.ts", "sentry.edge.config.ts", "prisma.playwright.config.ts",
];

export const TEAM_VIDEO_EXECUTION_FILES = [
  ...TEAM_VIDEO_MIRROR_CONFIG_FILES,
  "package-lock.json", "playwright.team-video.config.ts", "playwright.config.ts",
  "scripts/team-video-disposable-qa.mjs", "scripts/team-video-source-snapshot.mjs",
  "scripts/team-video-source-snapshot.test.mjs", "scripts/playwright-ci-reporter.ts",
  "scripts/prisma-loopback-disposable-migration-runner.mjs",
  "scripts/prisma-migrate-status-diagnostic.mjs", "scripts/local-database-safety.ts",
  "tests/e2e/team-video-persistence-isolation.spec.ts",
  "tests/e2e/wp86-team-template-direct-url-owner-boundary.spec.ts",
  "tests/fixtures/team-funnel.ts", "tests/e2e/helpers/direct-url-guard.ts",
  "vitest.config.ts", "scripts/node-tap-contract-tests.ts",
];

/** Snapshot only declared source files; never open dotenv or credential material. */
export function teamVideoSourceRevision(root) {
  const files = new Set(TEAM_VIDEO_EXECUTION_FILES);
  const walk = directory => {
    for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
      if (entry.name.startsWith(".env")) continue;
      const name = `${directory}/${entry.name}`;
      if (entry.isDirectory()) walk(name);
      else if (entry.isFile()) files.add(name);
    }
  };
  for (const directory of ["src", "prisma", "public"]) walk(directory);
  const digest = crypto.createHash("sha256");
  for (const name of [...files].sort()) {
    const data = fs.readFileSync(path.join(root, name));
    const length = Buffer.alloc(8);
    length.writeBigUInt64BE(BigInt(data.length));
    digest.update(`${name}\0`).update(length).update(data);
  }
  return `sha256:${digest.digest("hex")}`;
}
