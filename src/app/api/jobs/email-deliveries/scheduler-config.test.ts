import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Email delivery scheduler configuration", () => {
  it("does not register the Email delivery worker as a Vercel cron", () => {
    const config = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "vercel.json"), "utf8")) as {
      crons?: Array<{ path?: unknown }>;
    };

    // Preview runs on the Vercel Hobby project. The authenticated POST job
    // remains available to a separately controlled staging runner; this
    // project must not schedule this worker. Other independently reviewed
    // cron routes (such as the LINE outbox) keep their own contract.
    expect(config.crons ?? []).not.toContainEqual(
      expect.objectContaining({ path: "/api/jobs/email-deliveries" }),
    );
  });
});
