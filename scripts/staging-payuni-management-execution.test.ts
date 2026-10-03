import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const state = vi.hoisted(() => ({ failQuery: false, failCleanup: false, temporary: "", calls: [] as string[] }));
vi.mock("node:child_process", () => ({ spawnSync: (command: string, args: string[]) => {
  state.calls.push(`${command}:${args[0]}`);
  if (command === "supabase.exe" && args.includes("query") && state.failQuery) {
    return { status: null, error: new Error("synthetic timeout with SQL detail"), stdout: "", stderr: "sensitive child output" };
  }
  return { status: 0, stdout: args[0] === "--version" ? "2.108.0" : command === "whoami.exe" ? '"test","S-1-5-21-1-2-3-1001"' : "", stderr: "" };
} }));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual,
    lstatSync: (file: string) => file.endsWith("project-ref") ? { isFile: () => true, isSymbolicLink: () => false } : actual.lstatSync(file),
    readFileSync: (file: string, options: "utf8") => file.endsWith("project-ref") ? "ocbugvgojrunvenozsbx" : actual.readFileSync(file, options),
    mkdtempSync: (prefix: string) => { state.temporary = actual.mkdtempSync(prefix); return state.temporary; },
    unlinkSync: (file: string) => { if (state.failCleanup) throw new Error("synthetic cleanup failure"); actual.unlinkSync(file); },
  };
});
import { runPrepare } from "./staging-payuni-management-prepare";

function environment(): NodeJS.ProcessEnv {
  return { NODE_ENV: "test", STAGING_PAYUNI_TEST_VENDOR_CHANGE_APPROVED: "true", STAGING_PAYUNI_TEST_CHANGE_APPROVED: "true",
    STAGING_PAYUNI_TEST_ACCOUNT_EMAIL: "zeroyuanbrothers@gmail.com", PAYUNI_STAGING_PLAN_TEST_ENABLED: "false",
    VERCEL_ENV: "preview", VERCEL_PROJECT_ID: "prj_3d4ib8cXrF3f3HsqdSwfabpBWvZn",
    VERCEL_GIT_COMMIT_REF: "codex/prelaunch-engineering-20260929",
    NEXT_PUBLIC_APP_URL: "https://celebrate-deal-staging.carry-digital-nomad.in.net",
    NEXT_PUBLIC_SUPABASE_URL: "https://ocbugvgojrunvenozsbx.supabase.co" };
}
afterEach(() => {
  state.failCleanup = false;
  state.failQuery = false;
  // Delete only the exact files created by this test, without recursive removal.
  if (state.temporary && fs.existsSync(path.join(state.temporary, "prepare.sql"))) fs.unlinkSync(path.join(state.temporary, "prepare.sql"));
  if (state.temporary && fs.existsSync(state.temporary)) fs.rmdirSync(state.temporary);
  state.temporary = "";
  state.calls = [];
  vi.unstubAllGlobals();
});
describe("management prepare child failure handling", () => {
  it("cleans the SQL after an unknown CLI timeout without leaking child output", async () => {
    vi.stubGlobal("process", { ...process, platform: "win32" });
    state.failQuery = true;
    await expect(runPrepare(["--prepare"], environment())).rejects.toThrow(/^PREPARE_CHILD_FAILED$/u);
    expect(fs.existsSync(state.temporary)).toBe(false);
    expect(state.calls.filter((call) => call === "supabase.exe:--workdir")).toHaveLength(1);
  });
  it("reports cleanup failure after a successful query without automatically rerunning", async () => {
    vi.stubGlobal("process", { ...process, platform: "win32" });
    state.failCleanup = true;
    await expect(runPrepare(["--prepare"], environment())).rejects.toThrow(/^PREPARE_TEMP_CLEANUP_FAILED$/u);
    expect(state.calls.filter((call) => call === "supabase.exe:--workdir")).toHaveLength(1);
  });
});
