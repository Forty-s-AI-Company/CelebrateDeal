import { createHmac } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registrationSubmissionIdFromRequest } from "@/lib/evergreen-session-assignment";
import { FORM_SUBMISSION_CHAT_SESSION_COOKIE, createFormSubmissionChatSessionToken, verifyFormSubmissionChatSessionToken } from "@/lib/form-submission-chat-session";
import { FORM_SUBMISSION_LINE_BINDING_COOKIE, verifyFormSubmissionLineBindingToken } from "@/lib/form-submission-line-binding-session";
import {
  createLiveAttendanceToken,
  createLiveSessionHintToken,
  LIVE_ATTENDANCE_COOKIE_HEADER_MAX_LENGTH,
  LIVE_ATTENDANCE_COOKIE_PATH,
  LIVE_SESSION_HINT_COOKIE_PATH,
  liveAttendanceCookieName,
  liveAttendanceCookieOptions,
  liveAttendanceSubmissionIdFromRequest,
  liveSessionHintCookieName,
  liveSessionHintCookieOptions,
  liveSessionHintSubmissionId,
  liveSessionHintTokenFromCookieHeader,
  verifyLiveAttendanceToken,
  verifyLiveSessionHintToken,
} from "@/lib/live-attendance-cookie";
import { chatSessionTokenFromRequest } from "@/lib/live-chat";
import { registrationSessionTokenFromRequest } from "@/lib/live-fixed-sessions-store";
import { createLiveWatchLinkToken, verifyLiveWatchLinkToken } from "@/lib/live-watch-link-token";
import { deriveSensitiveDataKey } from "@/lib/sensitive-data";

const NOW = new Date("2026-11-01T02:00:00.000Z");
const DAY = 86_400_000;
const CLAIM = { vendorId: "vendor_a", liveId: "live_a", submissionId: "submission_a", expiresAt: new Date(NOW.getTime() + 30 * DAY) };

function requestWith(cookie: string) {
  return new Request("https://app.example.test/api/live-admission", { method: "POST", headers: { cookie } });
}

describe("attendance-only cookie (Q-17)", () => {
  beforeEach(() => vi.stubEnv("CSRF_SECRET", "live-attendance-cookie-test-secret-longer-than-32-bytes"));
  afterEach(() => vi.unstubAllEnvs());

  it("round-trips vendor, Live, registration and expiry, and refuses an expired or over-long cookie", () => {
    const token = createLiveAttendanceToken(CLAIM);
    expect(verifyLiveAttendanceToken(token, NOW)).toEqual(CLAIM);
    expect(verifyLiveAttendanceToken(token, CLAIM.expiresAt)).toBeNull();
    expect(verifyLiveAttendanceToken(createLiveAttendanceToken({ ...CLAIM, expiresAt: new Date(NOW.getTime() + 401 * DAY) }), NOW)).toBeNull();
    expect(Object.keys(JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString("utf8")))).toEqual(["v", "l", "s", "e"]);
    expect(() => createLiveAttendanceToken({ ...CLAIM, submissionId: "a/b" })).toThrow("Invalid attendance cookie binding.");
  });

  it("refuses tampered claims, other keys and other versions", () => {
    const token = createLiveAttendanceToken(CLAIM);
    const [version, payload, signature] = token.split(".");
    const claims = JSON.parse(Buffer.from(payload!, "base64url").toString("utf8")) as Record<string, unknown>;
    for (const change of [{ s: "submission_b" }, { l: "live_b" }, { v: "vendor_b" }]) {
      expect(verifyLiveAttendanceToken(`${version}.${Buffer.from(JSON.stringify({ ...claims, ...change })).toString("base64url")}.${signature}`, NOW)).toBeNull();
    }
    for (const purpose of ["live-watch-link:r2:847e45b6e28a9b99", "form-submission-chat-session:r2:070a4f7ffaff8f24", "live-attendance"]) {
      const mac = createHmac("sha256", deriveSensitiveDataKey(purpose)).update(`${version}.${payload}`).digest("base64url");
      expect(verifyLiveAttendanceToken(`${version}.${payload}.${mac}`, NOW), purpose).toBeNull();
    }
    expect(verifyLiveAttendanceToken(`lat2.${payload}.${signature}`, NOW)).toBeNull();
    expect(verifyLiveAttendanceToken("", NOW)).toBeNull();
  });

  it("is not interchangeable with the watch link, the registration cookie or the LINE binding cookie", () => {
    const attendance = createLiveAttendanceToken(CLAIM);
    const watchLink = createLiveWatchLinkToken({ vendorId: "vendor_a", liveId: "live_a", submissionId: "submission_a", sessionStartAt: NOW }, NOW);
    const registration = createFormSubmissionChatSessionToken({ submissionId: "submission_a", now: NOW });
    expect(verifyFormSubmissionChatSessionToken(attendance, NOW)).toBeNull();
    expect(verifyFormSubmissionLineBindingToken(attendance, NOW)).toBeNull();
    expect(verifyLiveWatchLinkToken(attendance, NOW)).toBeNull();
    expect(verifyLiveAttendanceToken(watchLink, NOW)).toBeNull();
    expect(verifyLiveAttendanceToken(registration, NOW)).toBeNull();
  });

  it("is one cookie per Live, scoped to /api/live-admission and expiring with the link", () => {
    const name = liveAttendanceCookieName("live_a");
    expect(name).toMatch(/^celebratedeal_la_[0-9a-f]{24}$/u);
    expect(liveAttendanceCookieName("live_b")).not.toBe(name);
    expect(liveAttendanceCookieName("a/b")).toBeNull();
    expect(LIVE_ATTENDANCE_COOKIE_PATH).toBe("/api/live-admission");
    expect(liveAttendanceCookieOptions(true, CLAIM.expiresAt, NOW)).toEqual({
      httpOnly: true, sameSite: "lax", secure: true, path: "/api/live-admission", maxAge: 30 * 86_400,
    });
  });

  it("names a registration only for its own Live and vendor, and trusts no duplicate cookie", () => {
    const name = liveAttendanceCookieName("live_a")!;
    const cookie = `${name}=${createLiveAttendanceToken(CLAIM)}`;
    expect(liveAttendanceSubmissionIdFromRequest(requestWith(cookie), { vendorId: "vendor_a", liveId: "live_a", now: NOW })).toBe("submission_a");
    expect(liveAttendanceSubmissionIdFromRequest(requestWith(cookie), { vendorId: "vendor_b", liveId: "live_a", now: NOW })).toBeNull();
    // A cookie of Live A placed under Live B's name.
    const misplaced = `${liveAttendanceCookieName("live_b")}=${createLiveAttendanceToken(CLAIM)}`;
    expect(liveAttendanceSubmissionIdFromRequest(requestWith(misplaced), { vendorId: "vendor_a", liveId: "live_b", now: NOW })).toBeNull();
    expect(liveAttendanceSubmissionIdFromRequest(requestWith(`${cookie}; ${cookie}`), { vendorId: "vendor_a", liveId: "live_a", now: NOW })).toBeNull();
  });

  it("reads a cookie header as long as the registration cookie reader does, up to 16 KiB (review n-1)", () => {
    const name = liveAttendanceCookieName("live_a")!;
    const cookie = `${name}=${createLiveAttendanceToken(CLAIM)}`;
    const input = { vendorId: "vendor_a", liveId: "live_a", now: NOW };
    const padded = (length: number) => {
      const base = `${cookie}; other=`;
      return `${base}${"x".repeat(length - base.length)}`;
    };
    expect(LIVE_ATTENDANCE_COOKIE_HEADER_MAX_LENGTH).toBe(16_384);
    // A browser with many cookies (well past the old 8 KiB) still counts.
    expect(padded(12_000)).toHaveLength(12_000);
    expect(liveAttendanceSubmissionIdFromRequest(requestWith(padded(12_000)), input)).toBe("submission_a");
    expect(liveAttendanceSubmissionIdFromRequest(requestWith(padded(16_384)), input)).toBe("submission_a");
    expect(liveAttendanceSubmissionIdFromRequest(requestWith(padded(16_385)), input)).toBeNull();
    // The registration cookie reader accepts the same 12 KiB header.
    const registration = createFormSubmissionChatSessionToken({ submissionId: "submission_a", now: NOW });
    const withRegistration = `${FORM_SUBMISSION_CHAT_SESSION_COOKIE}=${registration}; other=${"x".repeat(12_000)}`;
    expect(registrationSessionTokenFromRequest(requestWith(withRegistration))).toBe(registration);
  });

  it("is never read as a registration identity: chat, private chat, fixed sessions, evergreen, LINE binding", () => {
    const attendance = createLiveAttendanceToken(CLAIM);
    const onlyAttendance = requestWith(`${liveAttendanceCookieName("live_a")}=${attendance}`);
    // Chat and private chat take their identity from this reader.
    expect(chatSessionTokenFromRequest(onlyAttendance)).toBeNull();
    // Fixed-session schedule, evergreen session records and attendance.
    expect(registrationSessionTokenFromRequest(onlyAttendance)).toBeNull();
    expect(registrationSubmissionIdFromRequest(onlyAttendance, NOW)).toBeNull();
    // Its value copied under the registration or LINE binding cookie name is refused by their verifiers.
    const disguised = requestWith(`${FORM_SUBMISSION_CHAT_SESSION_COOKIE}=${attendance}; ${FORM_SUBMISSION_LINE_BINDING_COOKIE}=${attendance}`);
    expect(registrationSubmissionIdFromRequest(disguised, NOW)).toBeNull();
    expect(verifyFormSubmissionChatSessionToken(chatSessionTokenFromRequest(disguised) ?? "", NOW)).toBeNull();
  });

  // Walks src/ once (cached for the next test); slower disks need more than the default 5 s.
  it("is imported only by the watch link, the attendance recorder and (for the session hint only) the fixed-session resolver", { timeout: 30_000 }, () => {
    const allowed = new Set([
      "lib/live-attendance-cookie.ts",
      "lib/live-attendance-cookie.test.ts",
      "lib/live-registration-attendance.ts",
      "lib/live-watch-link.ts",
      "app/api/live-watch-link/route.ts",
      "app/api/live-watch-link/route.db.test.ts",
      "app/api/live-watch-link/route.test.ts",
      "app/api/live-chat/private/route.test.ts",
      // Q-11 viewer_watch_progress: a personal link's device shares the registrant's watch clock.
      "lib/watch-progress-automation.db.test.ts",
      // A2-10: the fixed-session resolver reads the session-hint cookie only (checked below).
      "lib/live-fixed-sessions-store.ts",
      "lib/live-fixed-session-attendance-hint.db.test.ts",
      "app/(viewer)/live/[slug]/page.test.tsx",
      // The key registry and its tests name the purpose; they read no cookie.
      "lib/derived-key-purposes.ts",
      "lib/derived-key-rotation.test.ts",
    ]);
    const offenders = scanSources((source) => /from\s+["'][^"']*live-attendance-cookie["']|import\(\s*["'][^"']*live-attendance-cookie["']/u.test(source)
      || source.includes("celebratedeal_la_")
      || source.includes("liveAttendance"))
      .filter((relative) => !allowed.has(relative));
    expect(offenders).toEqual([]);
    // The attendance reader stays the recorder's alone; the resolver takes only the hint.
    expect(scanSources((source) => source.includes("liveAttendanceSubmissionIdFromRequest")).filter((file) => !file.endsWith(".test.ts")))
      .toEqual(["lib/live-attendance-cookie.ts", "lib/live-registration-attendance.ts"]);
  });

  it("lets only the fixed-session resolver read the session hint (A2-10)", { timeout: 30_000 }, () => {
    const readers = scanSources((source) => /liveSessionHint(?:SubmissionId|TokenFromCookieHeader)\b/u.test(source) || source.includes("celebratedeal_lsh_"))
      .filter((file) => !/\.test\.tsx?$/u.test(file));
    expect(readers).toEqual(["lib/live-attendance-cookie.ts", "lib/live-fixed-sessions-store.ts"]);
    // And the store's own wrappers reach only the four viewer paths that pick a fixed session
    // (the waiting-room video follows the same session to know whether the room is still waiting).
    const callers = scanSources((source) => /sessionHintTokenFrom(?:Request|CookieHeader)\b/u.test(source))
      .filter((file) => !/\.test\.tsx?$/u.test(file));
    expect(callers).toEqual([
      "app/(viewer)/live/[slug]/page.tsx",
      "app/api/live-admission/route.ts",
      "app/api/live-playback-source/route.ts",
      "app/api/live-waiting-source/route.ts",
      "lib/live-fixed-sessions-store.ts",
    ]);
  });
});

describe("session-hint cookie (A2-10, #634 option b)", () => {
  beforeEach(() => vi.stubEnv("CSRF_SECRET", "live-attendance-cookie-test-secret-longer-than-32-bytes"));
  afterEach(() => vi.unstubAllEnvs());

  const INPUT = { vendorId: "vendor_a", liveId: "live_a", now: NOW };

  it("round-trips the registration and expiry under its own version, name and site-wide path", () => {
    const hint = createLiveSessionHintToken(CLAIM);
    expect(hint.startsWith("lsh1.")).toBe(true);
    expect(verifyLiveSessionHintToken(hint, INPUT)).toEqual({ submissionId: CLAIM.submissionId, expiresAt: CLAIM.expiresAt });
    expect(verifyLiveSessionHintToken(hint, { ...INPUT, now: CLAIM.expiresAt })).toBeNull();
    expect(verifyLiveSessionHintToken(createLiveSessionHintToken({ ...CLAIM, expiresAt: new Date(NOW.getTime() + 401 * DAY) }), INPUT)).toBeNull();
    const name = liveSessionHintCookieName("live_a");
    expect(name).toMatch(/^celebratedeal_lsh_[0-9a-f]{24}$/u);
    expect(name).not.toBe(liveAttendanceCookieName("live_a"));
    expect(liveSessionHintCookieName("live_b")).not.toBe(name);
    expect(liveSessionHintCookieName("a/b")).toBeNull();
    expect(LIVE_SESSION_HINT_COOKIE_PATH).toBe("/");
    expect(liveSessionHintCookieOptions(true, CLAIM.expiresAt, NOW)).toEqual({
      httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: 30 * 86_400,
    });
  });

  it("is not interchangeable with the attendance cookie, the watch link or the registration cookie", () => {
    const hint = createLiveSessionHintToken(CLAIM);
    const attendance = createLiveAttendanceToken(CLAIM);
    expect(verifyLiveAttendanceToken(hint, NOW)).toBeNull();
    expect(verifyLiveSessionHintToken(attendance, INPUT)).toBeNull();
    expect(verifyLiveSessionHintToken(createLiveWatchLinkToken({ ...CLAIM, sessionStartAt: NOW }, NOW), INPUT)).toBeNull();
    expect(verifyLiveSessionHintToken(createFormSubmissionChatSessionToken({ submissionId: "submission_a", now: NOW }), INPUT)).toBeNull();
    expect(verifyFormSubmissionChatSessionToken(hint, NOW)).toBeNull();
    // The attendance signature re-used in the hint format: refused.
    const [, , signature] = attendance.split(".");
    expect(verifyLiveSessionHintToken(`lsh1.submission_a.${Math.floor(CLAIM.expiresAt.getTime() / 1_000)}.${signature}`, INPUT)).toBeNull();
    // Under the attendance cookie's name a hint records nothing (and the reverse picks no session).
    const request = requestWith(`${liveAttendanceCookieName("live_a")}=${hint}`);
    expect(liveAttendanceSubmissionIdFromRequest(request, INPUT)).toBeNull();
    expect(liveSessionHintSubmissionId(liveSessionHintTokenFromCookieHeader(`${liveSessionHintCookieName("live_a")}=${attendance}`, "live_a"), INPUT)).toBeNull();
  });

  it("refuses tampered claims, another Live or vendor, and duplicate cookies", () => {
    const name = liveSessionHintCookieName("live_a")!;
    const hint = createLiveSessionHintToken(CLAIM);
    expect(liveSessionHintSubmissionId(liveSessionHintTokenFromCookieHeader(`${name}=${hint}`, "live_a"), INPUT)).toBe("submission_a");
    expect(liveSessionHintSubmissionId(hint, { ...INPUT, vendorId: "vendor_b" })).toBeNull();
    expect(liveSessionHintSubmissionId(hint, { ...INPUT, liveId: "live_b" })).toBeNull();
    // A hint of Live A placed under Live B's name is read but bound to Live A.
    expect(liveSessionHintSubmissionId(liveSessionHintTokenFromCookieHeader(`${liveSessionHintCookieName("live_b")}=${hint}`, "live_b"), { ...INPUT, liveId: "live_b" })).toBeNull();
    expect(liveSessionHintTokenFromCookieHeader(`${name}=${hint}; ${name}=${hint}`, "live_a")).toBeNull();
    expect(liveSessionHintTokenFromCookieHeader(`${name}=${"x".repeat(201)}`, "live_a")).toBeNull();
    expect(liveSessionHintTokenFromCookieHeader(null, "live_a")).toBeNull();
    const [version, submission, expiry, signature] = hint.split(".");
    for (const altered of [
      `${version}.submission_b.${expiry}.${signature}`,
      `${version}.${submission}.${Number(expiry) + 60}.${signature}`,
      `${version}.${submission}.${expiry}.${signature!.slice(0, -2)}${signature!.endsWith("AA") ? "BB" : "AA"}`,
      `lsh2.${submission}.${expiry}.${signature}`,
      `${hint}.extra`,
      `${version}.${submission}.0${expiry}.${signature}`,
    ]) {
      expect(liveSessionHintSubmissionId(altered, INPUT), altered.slice(0, 40)).toBeNull();
    }
  });

  it("keeps vendor and Live out of the token but inside the signature (review MINOR-3)", () => {
    const hint = createLiveSessionHintToken(CLAIM);
    expect(hint.split(".")).toHaveLength(4);
    expect(hint).not.toContain("vendor_a");
    expect(hint).not.toContain("live_a");
    // A realistic cuid registration id: the whole cookie stays small.
    const realistic = createLiveSessionHintToken({ ...CLAIM, vendorId: "c".repeat(25), liveId: "d".repeat(25), submissionId: "e".repeat(25) });
    const cookie = `${liveSessionHintCookieName("d".repeat(25))}=${realistic}`;
    expect(realistic.length).toBeLessThanOrEqual(90);
    expect(cookie.length).toBeLessThanOrEqual(135);
    const attendanceCookie = `${liveAttendanceCookieName("d".repeat(25))}=${createLiveAttendanceToken({ ...CLAIM, vendorId: "c".repeat(25), liveId: "d".repeat(25), submissionId: "e".repeat(25) })}`;
    // What one fixed-session Live adds to an admission request's Cookie header (both cookies and the "; " separators).
    expect(cookie.length + attendanceCookie.length + 4).toBeLessThanOrEqual(400);
  });

  it("is never read as a registration identity: chat, private chat, evergreen, LINE binding, attendance", () => {
    const onlyHint = requestWith(`${liveSessionHintCookieName("live_a")}=${createLiveSessionHintToken(CLAIM)}`);
    expect(chatSessionTokenFromRequest(onlyHint)).toBeNull();
    expect(registrationSessionTokenFromRequest(onlyHint)).toBeNull();
    expect(registrationSubmissionIdFromRequest(onlyHint, NOW)).toBeNull();
    expect(liveAttendanceSubmissionIdFromRequest(onlyHint, INPUT)).toBeNull();
  });
});

let sources: Array<{ file: string; source: string }> | null = null;

/** Every .ts/.tsx file under src/, read once per test file. */
function sourceFiles() {
  if (sources) return sources;
  const root = path.resolve(__dirname, "..");
  const found: Array<{ file: string; source: string }> = [];
  // Directory entries carry their type, and each file is read directly
  // (no separate stat before the read), so there is no check-then-use race.
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && /\.(?:ts|tsx)$/u.test(entry.name)) {
        try {
          found.push({ file: path.relative(root, full).split(path.sep).join("/"), source: readFileSync(full, "utf8") });
        } catch (error) {
          // A file removed while scanning cannot reference the cookie.
          if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
          throw error;
        }
      }
    }
  };
  walk(root);
  sources = found;
  return found;
}

/** Source files under src/ (relative, sorted) whose text matches. */
function scanSources(matches: (source: string) => boolean) {
  return sourceFiles().filter(({ source }) => matches(source)).map(({ file }) => file).sort();
}
