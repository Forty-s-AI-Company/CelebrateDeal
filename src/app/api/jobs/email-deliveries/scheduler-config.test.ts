import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Email delivery scheduler configuration", () => {
  it("does not register a Vercel cron in the Preview project", () => {
    const config = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "vercel.json"), "utf8")) as {
      crons?: unknown;
    };

    // Preview runs on the Vercel Hobby project. The authenticated POST job
    // remains available to a separately controlled staging runner; this
    // project must not fail deployment validation on a one-minute Vercel cron.
    expect(config).not.toHaveProperty("crons");
  });
});
