import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readJson(file: string) {
  return JSON.parse(fs.readFileSync(path.resolve(process.cwd(), file), "utf8")) as { crons?: unknown };
}

describe("Background job scheduler configuration (F-042)", () => {
  it("does not register a Vercel cron in the Preview project", () => {
    // Preview runs on the Vercel Hobby project. Hobby rejects any cron that
    // fires more than once a day during deployment validation, which is why
    // the earlier one-minute cron was removed from this file.
    expect(readJson("vercel.json")).not.toHaveProperty("crons");
  });

  it("keeps the staging config without Vercel crons because Vercel only invokes crons on Production deployments", () => {
    // The staging alias serves a Preview deployment (VERCEL_ENV=preview), so a
    // cron declared here would never fire and could fail Hobby validation.
    // Staging is driven by .github/workflows/scheduled-jobs.yml instead; see
    // docs/launch/scheduled-jobs-runbook.md for the Production Vercel Cron block.
    expect(readJson("vercel.staging.json").crons).toEqual([]);
  });

  it("drives staging jobs from the protected GitHub Actions scheduler", () => {
    const workflow = fs.readFileSync(path.resolve(process.cwd(), ".github/workflows/scheduled-jobs.yml"), "utf8");
    expect(workflow).toContain('- cron: "*/5 * * * *"');
    expect(workflow).toContain("node scripts/scheduled-jobs-runner.mjs email-deliveries");
    expect(workflow).toContain("JOB_SECRET: ${{ secrets.JOB_SECRET }}");
  });
});
