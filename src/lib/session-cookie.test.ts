import { describe, expect, it, vi } from "vitest";
import {
  AUTH_COOKIE,
  LEGACY_AUTH_COOKIE,
  LEGACY_AUTH_COOKIE_ISSUED_BEFORE,
  LEGACY_AUTH_COOKIE_SUNSET,
  clearSessionCookies,
  legacySessionCookieAllowed,
  readSessionCookie,
  readSessionCookieToken,
  sessionCookieOptions,
  writeSessionCookie,
} from "./session-cookie";

function jar(values: Record<string, string>) {
  return { get: (name: string) => (name in values ? { value: values[name]! } : undefined) };
}

function writer() {
  return { set: vi.fn(), delete: vi.fn() };
}

const beforeSunset = new Date(LEGACY_AUTH_COOKIE_SUNSET.getTime() - 1);

describe("session cookie (F-036)", () => {
  it("uses the __Host- prefix with Secure, Path=/ and no Domain regardless of NODE_ENV", () => {
    expect(AUTH_COOKIE).toBe("__Host-celebrate_session");
    for (const nodeEnv of ["development", "test", "production"]) {
      vi.stubEnv("NODE_ENV", nodeEnv);
      const options = sessionCookieOptions(new Date("2026-11-04T00:00:00.000Z"), 60);
      expect(options).toEqual({
        httpOnly: true,
        sameSite: "lax",
        secure: true,
        path: "/",
        maxAge: 60,
        expires: new Date("2026-11-04T00:00:00.000Z"),
      });
      expect(options).not.toHaveProperty("domain");
    }
    vi.unstubAllEnvs();
  });

  it("prefers the __Host- cookie and falls back to the legacy cookie only before the sunset", () => {
    expect(readSessionCookieToken(jar({ [AUTH_COOKIE]: "new", [LEGACY_AUTH_COOKIE]: "old" }), beforeSunset)).toBe("new");
    expect(readSessionCookieToken(jar({ [LEGACY_AUTH_COOKIE]: "old" }), beforeSunset)).toBe("old");
    expect(readSessionCookieToken(jar({ [LEGACY_AUTH_COOKIE]: "old" }), LEGACY_AUTH_COOKIE_SUNSET)).toBeUndefined();
    expect(readSessionCookieToken(jar({ [AUTH_COOKIE]: "new" }), LEGACY_AUTH_COOKIE_SUNSET)).toBe("new");
    expect(readSessionCookieToken(jar({ [LEGACY_AUTH_COOKIE]: "" }), beforeSunset)).toBeUndefined();
    expect(readSessionCookieToken(jar({}), beforeSunset)).toBeUndefined();
  });

  it("marks a legacy-name read so only pre-rollout sessions are honoured (M1)", () => {
    expect(readSessionCookie(jar({ [AUTH_COOKIE]: "new", [LEGACY_AUTH_COOKIE]: "old" }), beforeSunset)).toEqual({ token: "new", legacy: false });
    expect(readSessionCookie(jar({ [LEGACY_AUTH_COOKIE]: "old" }), beforeSunset)).toEqual({ token: "old", legacy: true });
    expect(readSessionCookie(jar({ [LEGACY_AUTH_COOKIE]: "old" }), LEGACY_AUTH_COOKIE_SUNSET)).toBeNull();

    expect(LEGACY_AUTH_COOKIE_ISSUED_BEFORE.getTime()).toBeLessThan(LEGACY_AUTH_COOKIE_SUNSET.getTime());
    expect(legacySessionCookieAllowed({ createdAt: new Date(LEGACY_AUTH_COOKIE_ISSUED_BEFORE.getTime() - 1) })).toBe(true);
    expect(legacySessionCookieAllowed({ createdAt: LEGACY_AUTH_COOKIE_ISSUED_BEFORE })).toBe(false);
    expect(legacySessionCookieAllowed({ createdAt: new Date(LEGACY_AUTH_COOKIE_ISSUED_BEFORE.getTime() + 1) })).toBe(false);
  });

  it("writes the __Host- cookie with a maxAge that matches the session row and expires the legacy cookie", () => {
    const store = writer();
    const now = new Date("2026-11-03T00:00:00.000Z");
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    writeSessionCookie(store, "token-1", expiresAt, now);

    expect(store.set).toHaveBeenCalledExactlyOnceWith(AUTH_COOKIE, "token-1", {
      httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: 24 * 60 * 60, expires: expiresAt,
    });
    expect(store.delete).toHaveBeenCalledExactlyOnceWith({
      name: LEGACY_AUTH_COOKIE, httpOnly: true, sameSite: "lax", secure: true, path: "/",
    });
  });

  it("clears both names with Secure and Path=/ and without a maxAge that would revive the cookie", () => {
    const store = writer();

    clearSessionCookies(store);

    expect(store.delete.mock.calls.map(([options]) => options)).toEqual([
      { name: AUTH_COOKIE, httpOnly: true, sameSite: "lax", secure: true, path: "/" },
      { name: LEGACY_AUTH_COOKIE, httpOnly: true, sameSite: "lax", secure: true, path: "/" },
    ]);
    expect(store.set).not.toHaveBeenCalled();
  });

  it("produces Set-Cookie headers a browser accepts for the __Host- prefix", async () => {
    const { NextResponse } = await import("next/server");
    const now = new Date();
    const response = new NextResponse(null);
    writeSessionCookie(response.cookies, "token-1", new Date(now.getTime() + 60_000), now);
    const [written, expiredLegacy] = response.headers.getSetCookie();

    expect(written).toMatch(/^__Host-celebrate_session=token-1;/);
    expect(written).toMatch(/; Path=\/(;|$)/);
    expect(written).toMatch(/; Secure(;|$)/);
    expect(written).not.toMatch(/Domain=/i);
    expect(expiredLegacy).toMatch(/^celebrate_session=;/);
    expect(expiredLegacy).toMatch(/Expires=Thu, 01 Jan 1970/);

    const cleared = new NextResponse(null);
    clearSessionCookies(cleared.cookies);
    const [hostDeletion] = cleared.headers.getSetCookie();
    expect(hostDeletion).toMatch(/^__Host-celebrate_session=;/);
    expect(hostDeletion).toMatch(/; Path=\/(;|$)/);
    expect(hostDeletion).toMatch(/; Secure(;|$)/);
    expect(hostDeletion).toMatch(/Expires=Thu, 01 Jan 1970/);
  });
});
