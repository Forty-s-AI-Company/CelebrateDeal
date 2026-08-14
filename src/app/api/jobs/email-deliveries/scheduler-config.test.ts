import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Email delivery scheduler configuration", () => {
  it("owns a source-controlled one-minute Vercel cron for the authenticated job route", () => {
    const config = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "vercel.json"), "utf8")) as {
      crons?: Array<{ path?: string; schedule?: string }>;
    };

    expect(config.crons).toEqual(expect.arrayContaining([
      { path: "/api/jobs/email-deliveries", schedule: "* * * * *" },
    ]));
  });
});
