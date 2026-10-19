import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { buildLiveChatExportRows, liveChatRowsToCsv, realViewerMessageWhere, scheduledMessageEventWhere } from "./live-chat-analytics";

describe("live chat analytics isolation", () => {
  it("defines a strict real-viewer query that excludes every simulated or role-backed row", () => {
    const since = new Date("2026-08-10T00:00:00.000Z");
    expect(realViewerMessageWhere({ vendorId: "vendor-1", liveId: "live-1", createdAtGte: since })).toEqual({
      vendorId: "vendor-1",
      liveId: "live-1",
      source: "viewer",
      isSimulated: false,
      status: "visible",
      formSubmissionId: { not: null },
      roleId: null,
      createdAt: { gte: since },
    });
  });

  it("scopes scheduled counts to published scripts and active scheduled roles from the same vendor", () => {
    expect(scheduledMessageEventWhere({ vendorId: "vendor-1", scriptId: "script-1" })).toEqual({
      eventType: { in: ["chat_message", "reminder"] },
      message: { not: null },
      isSimulated: true,
      script: { id: "script-1", vendorId: "vendor-1", status: "published" },
      role: { is: { vendorId: "vendor-1", isActive: true, isScheduled: true } },
    });
  });

  it("exports viewer and scheduled rows with explicit, non-overlapping source semantics", () => {
    const rows = buildLiveChatExportRows({
      liveId: "live-1",
      scheduledAt: new Date("2026-08-17T10:00:00.000Z"),
      viewerMessages: [{ id: "viewer-1", liveId: "live-1", authorName: "真實觀眾", body: "真人留言", createdAt: new Date("2026-08-17T10:00:05.000Z") }],
      scheduledMessages: [{ id: "scheduled-1", triggerSec: 10, message: "排程留言", role: { name: "官方小編" } }],
    });

    expect(rows).toEqual([
      expect.objectContaining({ messageId: "viewer-1", source: "viewer", isSimulated: false, occurredAt: "2026-08-17T10:00:05.000Z" }),
      expect.objectContaining({ messageId: "scheduled-1", source: "scheduled", isSimulated: true, occurredAt: "2026-08-17T10:00:10.000Z" }),
    ]);
  });

  it("leaves an unprovable scheduled occurrence blank and neutralizes spreadsheet formulas", () => {
    const rows = buildLiveChatExportRows({
      liveId: "live-1",
      scheduledAt: null,
      viewerMessages: [],
      scheduledMessages: [{ id: "scheduled-1", triggerSec: 10, message: "=HYPERLINK(\"https://attacker.example\")", role: { name: "+小編" } }],
    });
    const csv = liveChatRowsToCsv(rows);

    expect(rows[0]?.occurredAt).toBe("");
    expect(csv).toContain("\"'=HYPERLINK(\"\"https://attacker.example\"\")\"");
    expect(csv).toContain("\"'+小編\"");
  });

  it.each([
    [" =1+1", "' =1+1"],
    ["\t=1+1", "'\t=1+1"],
    ["\r\n@SUM(A1)", "'\r\n@SUM(A1)"],
    [" safe text", " safe text"],
  ])("neutralizes formulas after leading whitespace in %j", (input, expected) => {
    const rows = buildLiveChatExportRows({
      liveId: "live-1",
      scheduledAt: null,
      viewerMessages: [{ id: "viewer-1", liveId: "live-1", authorName: input, body: "body", createdAt: new Date("2026-08-17T00:00:00.000Z") }],
      scheduledMessages: [],
    });
    expect(liveChatRowsToCsv(rows)).toContain(`"${expected.replaceAll('"', '""')}"`);
  });

  it("keeps virtual users out of real-viewer statistics: every liveChatMessage count goes through realViewerMessageWhere", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/u.test(name) && !/\.(test|spec)\./u.test(name)) files.push(path);
      }
    };
    walk(join(process.cwd(), "src"));
    const offenders = files.filter((file) => {
      const source = readFileSync(file, "utf8");
      return /liveChatMessage\.(count|aggregate|groupBy)\(/u.test(source) && !source.includes("realViewerMessageWhere");
    });
    expect(offenders).toEqual([]);
  });

  it("never treats a role-backed, simulated or scheduled message as a real viewer message", () => {
    const where = realViewerMessageWhere({ vendorId: "vendor-1" });
    expect(where.roleId).toBeNull();
    expect(where.isSimulated).toBe(false);
    expect(where.source).toBe("viewer");
    expect(where.formSubmissionId).toEqual({ not: null });
  });
});
