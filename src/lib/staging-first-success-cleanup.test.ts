import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ getDb: () => { throw new Error("no database in unit tests"); } }));

import { firstSuccessOwnerEmail } from "@/lib/staging-first-success";
import {
  FIRST_SUCCESS_CLEANUP_MODE_HEADER,
  FIRST_SUCCESS_CLEANUP_RETENTION_DAYS,
  emptyFirstSuccessCleanupReceipt,
  firstSuccessRunIdFromOwnerEmail,
  isFirstSuccessWorkspaceSlug,
  readFirstSuccessCleanupMode,
  runFirstSuccessCleanup,
} from "@/lib/staging-first-success-cleanup";

const runId = "0123456789abcdef01234567";

function withMode(value?: string) {
  return new Request("https://staging.example.test/api/admin/ops/first-success/cleanup", {
    method: "POST",
    headers: value === undefined ? {} : { [FIRST_SUCCESS_CLEANUP_MODE_HEADER]: value },
  });
}

describe("first-success cleanup matching rules", () => {
  it("recognises only the exact runner owner mailbox", () => {
    expect(firstSuccessRunIdFromOwnerEmail(firstSuccessOwnerEmail(runId))).toBe(runId);
    for (const email of [
      `delivered+cdfs-buyer-${runId}@resend.dev`,
      `delivered+cdfs-owner-${runId.slice(0, 23)}@resend.dev`,
      `delivered+cdfs-owner-${runId}0@resend.dev`,
      `delivered+cdfs-owner-${runId.toUpperCase()}@resend.dev`,
      `delivered+cdfs-owner-${runId}@resend.dev.example.test`,
      `x-delivered+cdfs-owner-${runId}@resend.dev`,
      `Delivered+cdfs-owner-${runId}@resend.dev`,
      `delivered+cdfs-owner-${runId}@resend.dev\n`,
      `owner-${runId}@example.test`,
    ]) {
      expect(firstSuccessRunIdFromOwnerEmail(email), email).toBeNull();
    }
  });

  it("binds the workspace slug to the same run id, not to a name", () => {
    const uuid = "3f2b8c1e-9a4d-4f6b-8e2a-1c5d7e9f0a1b";
    expect(isFirstSuccessWorkspaceSlug(`synthetic-workspace-${runId.slice(0, 10)}-${uuid}`, runId)).toBe(true);
    for (const slug of [
      `synthetic-workspace-${"f".repeat(10)}-${uuid}`,
      `synthetic-workspace-${runId.slice(0, 10)}`,
      `synthetic-workspace-${runId.slice(0, 10)}-${uuid}-copy`,
      `my-synthetic-workspace-${runId.slice(0, 10)}-${uuid}`,
      `wuhe-select-${uuid}`,
    ]) {
      expect(isFirstSuccessWorkspaceSlug(slug, runId), slug).toBe(false);
    }
  });

  it("stays in step with how the runner names its workspace and how registration builds the slug", () => {
    const root = process.cwd();
    const runner = readFileSync(path.join(root, "scripts/staging-first-success.mjs"), "utf8");
    expect(runner).toContain("const short = runId.slice(0, 10);");
    expect(runner).toContain("fill(`Synthetic workspace ${short}`)");
    const registration = readFileSync(path.join(root, "src/app/actions/registration-actions.ts"), "utf8");
    expect(registration).toContain('const slugBase = input.workspaceName.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 80) || "workspace";');
    expect(registration).toContain("slug: `${slugBase}-${randomUUID()}`");
  });

  it("requires an explicit mode and accepts nothing but the two modes", () => {
    expect(readFirstSuccessCleanupMode(withMode())).toBeNull();
    expect(readFirstSuccessCleanupMode(withMode("deactivate"))).toBe("deactivate");
    expect(readFirstSuccessCleanupMode(withMode("delete"))).toBe("delete");
    // (Fetch trims surrounding whitespace from header values, so "delete " arrives as "delete".)
    for (const value of ["", "Delete", "DELETE", "purge", "delete-all", "deactivate,delete"]) expect(readFirstSuccessCleanupMode(withMode(value)), value).toBeNull();
  });
});

describe("first-success cleanup runtime boundary", () => {
  it("refuses Production and any unbound runtime before touching the database", async () => {
    const db = { vendor: { findMany: vi.fn(), count: vi.fn() }, auditLog: { create: vi.fn() }, $transaction: vi.fn() };
    for (const env of [
      { VERCEL_ENV: "production", PAYUNI_ENV: "production" },
      { VERCEL_ENV: "production", PAYUNI_ENV: "sandbox", WP4_SANDBOX_EXECUTOR_ENABLED: "true" },
      { VERCEL_ENV: "preview", PAYUNI_ENV: "sandbox", WP4_SANDBOX_EXECUTOR_ENABLED: "true" },
      {},
    ]) {
      for (const mode of ["deactivate", "delete"] as const) {
        await expect(runFirstSuccessCleanup({ mode, env, db: db as never })).resolves.toEqual(emptyFirstSuccessCleanupReceipt(mode));
      }
    }
    expect(db.vendor.findMany).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  it("has a de-identified receipt shape with the seven-day retention", () => {
    const receipt = emptyFirstSuccessCleanupReceipt("delete");
    expect(receipt).toMatchObject({ result: "REFUSED", retentionDays: 7 });
    expect(FIRST_SUCCESS_CLEANUP_RETENTION_DAYS).toBeGreaterThanOrEqual(7);
    expect(JSON.stringify(receipt)).not.toMatch(/@|email|slug|vendorId/u);
  });
});
