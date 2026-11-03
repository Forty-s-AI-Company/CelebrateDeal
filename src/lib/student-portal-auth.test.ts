import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookieDelete: vi.fn(),
  cookieGet: vi.fn(),
  cookieSet: vi.fn(),
  redirect: vi.fn(),
  tokenDeleteMany: vi.fn(),
  tokenFindFirst: vi.fn(),
  vendorFindFirst: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: mocks.cookieGet, set: mocks.cookieSet, delete: mocks.cookieDelete }),
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    vendor: { findFirst: mocks.vendorFindFirst },
    studentPortalAccessToken: { create: vi.fn(), updateMany: vi.fn(), findFirst: mocks.tokenFindFirst, deleteMany: mocks.tokenDeleteMany },
  }),
}));

import {
  STUDENT_PORTAL_ACCESS_TOKEN_TTL_SECONDS,
  STUDENT_PORTAL_SESSION_COOKIE,
  clearStudentPortalSessionCookie,
  consumeStudentPortalAccessToken,
  createStudentPortalAccessToken,
  createStudentPortalSessionToken,
  getCurrentStudentPortalSession,
  readStudentPortalSessionToken,
  requireStudentPortalSession,
  revokeStudentPortalSessions,
  STUDENT_PORTAL_SESSION_TTL_SECONDS,
  setStudentPortalSessionCookie,
  studentPortalSessionCookieOptions,
  verifyStudentPortalAccessToken,
} from "@/lib/student-portal-auth";

const now = new Date("2026-09-09T08:00:00.000Z");
const customerKeyHash = "a".repeat(43);
const grant = "g".repeat(43);

function tokenStore() {
  return { create: vi.fn().mockResolvedValue({}), updateMany: vi.fn().mockResolvedValue({ count: 1 }) };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.clearAllMocks();
  vi.stubEnv("CSRF_SECRET", "student-portal-auth-test-secret-at-least-thirty-two-bytes");
  mocks.redirect.mockImplementation((path: string) => { throw new Error(`redirect:${path}`); });
  mocks.cookieGet.mockReturnValue(undefined);
  mocks.tokenFindFirst.mockResolvedValue({ id: "portal-token-row-1" });
  mocks.tokenDeleteMany.mockResolvedValue({ count: 1 });
});

describe("student portal access tokens", () => {
  it("issues a 15-minute signed magic link without persisting raw email", async () => {
    const store = tokenStore();
    const issued = await createStudentPortalAccessToken({ studentPortalAccessToken: store }, {
      vendorId: "vendor_1",
      email: " Student@Example.Test ",
      purpose: "magic_link",
      now,
    });

    expect(verifyStudentPortalAccessToken({ token: issued, expectedPurpose: "magic_link", now })).toMatchObject({
      vendorId: "vendor_1",
      customerKeyHash: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u),
      purpose: "magic_link",
      issuedAt: now,
      expiresAt: new Date(now.getTime() + STUDENT_PORTAL_ACCESS_TOKEN_TTL_SECONDS * 1_000),
    });
    expect(store.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ vendorId: "vendor_1", purpose: "magic_link", customerKeyHash: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u) }),
    }));
    expect(store.create.mock.calls[0]?.[0].data).not.toHaveProperty("email");
    expect(Buffer.from(issued.split(".")[1]!, "base64url").toString("utf8")).not.toContain("student@example.test");
  });

  it("rejects tampering, expiry, and purpose confusion before database consumption", async () => {
    const store = tokenStore();
    const issued = await createStudentPortalAccessToken({ studentPortalAccessToken: store }, {
      vendorId: "vendor_1", email: "student@example.test", purpose: "magic_link", now,
    });
    const tampered = `${issued.slice(0, -1)}${issued.endsWith("a") ? "b" : "a"}`;

    expect(verifyStudentPortalAccessToken({ token: tampered, now })).toBeNull();
    expect(verifyStudentPortalAccessToken({ token: issued, now: new Date(now.getTime() + (STUDENT_PORTAL_ACCESS_TOKEN_TTL_SECONDS + 1) * 1_000) })).toBeNull();
    await expect(consumeStudentPortalAccessToken({ studentPortalAccessToken: store }, {
      token: issued, expectedPurpose: "checkout_redirect", now,
    })).resolves.toBeNull();
    expect(store.updateMany).not.toHaveBeenCalled();
  });

  it("consumes the matching tenant capability atomically exactly once", async () => {
    const store = tokenStore();
    const issued = await createStudentPortalAccessToken({ studentPortalAccessToken: store }, {
      vendorId: "vendor_1", email: "student@example.test", purpose: "checkout_redirect", now,
    });
    const consumed = await consumeStudentPortalAccessToken({ studentPortalAccessToken: store }, {
      token: issued, expectedPurpose: "checkout_redirect", now,
    });

    expect(consumed).toMatchObject({ vendorId: "vendor_1", customerKeyHash: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u), purpose: "checkout_redirect" });
    expect(store.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        vendorId: "vendor_1",
        customerKeyHash: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u),
        purpose: "checkout_redirect",
        consumedAt: null,
        expiresAt: { gt: now },
      }),
      data: { consumedAt: now },
    }));

    store.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(consumeStudentPortalAccessToken({ studentPortalAccessToken: store }, {
      token: issued, expectedPurpose: "checkout_redirect", now,
    })).resolves.toBeNull();
  });
});

describe("student portal encrypted sessions", () => {
  it("encrypts the tenant/customer binding and rejects modified or expired cookies", () => {
    const token = createStudentPortalSessionToken({ vendorId: "vendor_1", customerKeyHash, grant, now, ttlSeconds: 60 });
    expect(token).not.toContain("vendor_1");
    expect(token).not.toContain(grant);
    expect(readStudentPortalSessionToken(token, now)).toEqual({
      vendorId: "vendor_1",
      customerKeyHash,
      issuedAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
      grant,
    });
    expect(readStudentPortalSessionToken(`${token}x`, now)).toBeNull();
    expect(readStudentPortalSessionToken(token, new Date(now.getTime() + 61_000))).toBeNull();
  });

  it("writes an HttpOnly scoped cookie and verifies the slug belongs to the session vendor", async () => {
    await setStudentPortalSessionCookie({ vendorId: "vendor_1", customerKeyHash, grant });
    expect(mocks.cookieSet).toHaveBeenCalledWith(
      STUDENT_PORTAL_SESSION_COOKIE,
      expect.any(String),
      studentPortalSessionCookieOptions(),
    );
    expect(readStudentPortalSessionToken(mocks.cookieSet.mock.calls[0]?.[1] as string, now)).toMatchObject({ grant });

    mocks.cookieGet.mockReturnValue({ value: createStudentPortalSessionToken({ vendorId: "vendor_1", customerKeyHash, grant, now }) });
    mocks.vendorFindFirst.mockResolvedValue({ id: "vendor_1", slug: "acme", name: "Acme", logoUrl: null, primaryColor: "#2563eb" });
    await expect(requireStudentPortalSession("acme")).resolves.toMatchObject({
      session: { vendorId: "vendor_1", customerKeyHash }, vendor: { slug: "acme" },
    });
    expect(mocks.vendorFindFirst).toHaveBeenCalledWith({
      where: { id: "vendor_1", slug: "acme" },
      select: { id: true, slug: true, name: true, logoUrl: true, primaryColor: true },
    });
  });

  it("deletes the session cookie with the same portal path used when setting it", async () => {
    await clearStudentPortalSessionCookie();
    expect(mocks.cookieDelete).toHaveBeenCalledWith({ name: STUDENT_PORTAL_SESSION_COOKIE, path: "/portal" });
    expect(mocks.tokenDeleteMany).not.toHaveBeenCalled();
  });

  it("redirects unauthenticated portal visitors to only that vendor's login", async () => {
    await expect(requireStudentPortalSession("acme")).rejects.toThrow("redirect:/portal/acme/login");
    expect(mocks.vendorFindFirst).not.toHaveBeenCalled();
  });
});

describe("student portal session revocation (F-030)", () => {
  const sessionCookie = () => createStudentPortalSessionToken({ vendorId: "vendor_1", customerKeyHash, grant, now });

  it("keeps a session alive only while its consumed magic-link row exists for the same tenant and customer", async () => {
    mocks.cookieGet.mockReturnValue({ value: sessionCookie() });
    await expect(getCurrentStudentPortalSession()).resolves.toMatchObject({ vendorId: "vendor_1", grant });
    expect(mocks.tokenFindFirst).toHaveBeenCalledWith({
      where: { vendorId: "vendor_1", customerKeyHash, tokenHash: grant, consumedAt: { not: null } },
      select: { id: true },
    });

    mocks.tokenFindFirst.mockResolvedValue(null);
    await expect(getCurrentStudentPortalSession()).resolves.toBeNull();
    await expect(requireStudentPortalSession("acme")).rejects.toThrow("redirect:/portal/acme/login");
    expect(mocks.vendorFindFirst).not.toHaveBeenCalled();
  });

  it("refuses a pre-F-030 cookie that carries no grant without touching the database", async () => {
    mocks.cookieGet.mockReturnValue({ value: createStudentPortalSessionToken({ vendorId: "vendor_1", customerKeyHash, now }) });
    await expect(getCurrentStudentPortalSession()).resolves.toBeNull();
    expect(mocks.tokenFindFirst).not.toHaveBeenCalled();
  });

  it("sign-out deletes only this session's tenant-scoped row, so a copied cookie stops working", async () => {
    mocks.cookieGet.mockReturnValue({ value: sessionCookie() });
    await clearStudentPortalSessionCookie();
    expect(mocks.tokenDeleteMany).toHaveBeenCalledExactlyOnceWith({
      where: { vendorId: "vendor_1", customerKeyHash, tokenHash: grant, consumedAt: { not: null } },
    });
    expect(mocks.tokenDeleteMany.mock.invocationCallOrder[0]).toBeLessThan(mocks.cookieDelete.mock.invocationCallOrder[0]!);

    mocks.tokenFindFirst.mockResolvedValue(null);
    await expect(getCurrentStudentPortalSession()).resolves.toBeNull();
  });

  it("revokes the session a replaced cookie still names before writing the new one (M3)", async () => {
    const otherHash = "b".repeat(43);
    const previousGrant = "p".repeat(43);
    mocks.cookieGet.mockReturnValue({
      value: createStudentPortalSessionToken({ vendorId: "vendor_2", customerKeyHash: otherHash, grant: previousGrant, now }),
    });

    await setStudentPortalSessionCookie({ vendorId: "vendor_1", customerKeyHash, grant });

    expect(mocks.tokenDeleteMany).toHaveBeenCalledExactlyOnceWith({
      where: { vendorId: "vendor_2", customerKeyHash: otherHash, tokenHash: previousGrant, consumedAt: { not: null } },
    });
    expect(mocks.tokenDeleteMany.mock.invocationCallOrder[0]).toBeLessThan(mocks.cookieSet.mock.invocationCallOrder[0]!);
    expect(readStudentPortalSessionToken(mocks.cookieSet.mock.calls[0]?.[1] as string, now)).toMatchObject({ vendorId: "vendor_1", grant });
  });

  it("does not touch the database when the replaced cookie is unreadable or has no grant", async () => {
    for (const value of ["tampered", createStudentPortalSessionToken({ vendorId: "vendor_1", customerKeyHash, now })]) {
      mocks.cookieGet.mockReturnValue({ value });
      await setStudentPortalSessionCookie({ vendorId: "vendor_1", customerKeyHash, grant });
    }
    expect(mocks.tokenDeleteMany).not.toHaveBeenCalled();
    expect(mocks.cookieSet).toHaveBeenCalledTimes(2);
  });

  it("still removes the cookie when server-side revocation fails on sign-out", async () => {
    mocks.cookieGet.mockReturnValue({ value: sessionCookie() });
    mocks.tokenDeleteMany.mockRejectedValue(new Error("synthetic database outage"));

    await expect(clearStudentPortalSessionCookie()).rejects.toThrow("synthetic database outage");
    expect(mocks.cookieDelete).toHaveBeenCalledWith({ name: STUDENT_PORTAL_SESSION_COOKIE, path: "/portal" });
  });

  it("revokes every session of one customer within one vendor", async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 2 });
    await expect(revokeStudentPortalSessions({ studentPortalAccessToken: { deleteMany } }, {
      vendorId: "vendor_1", email: " Student@Example.Test ",
    })).resolves.toBe(2);
    const where = deleteMany.mock.calls[0]?.[0].where;
    expect(where.vendorId).toBe("vendor_1");
    expect(where.customerKeyHash).toMatch(/^[A-Za-z0-9_-]{43}$/u);

    await revokeStudentPortalSessions({ studentPortalAccessToken: { deleteMany } }, { vendorId: "vendor_2", email: "student@example.test" });
    expect(deleteMany.mock.calls[1]?.[0].where.customerKeyHash).not.toBe(where.customerKeyHash);
  });

  it("returns the consumed row digest as the session grant", async () => {
    const store = tokenStore();
    const issued = await createStudentPortalAccessToken({ studentPortalAccessToken: store }, {
      vendorId: "vendor_1", email: "student@example.test", purpose: "magic_link", now,
    });
    const consumed = await consumeStudentPortalAccessToken({ studentPortalAccessToken: store }, { token: issued, expectedPurpose: "magic_link", now });
    expect(consumed?.grant).toBe(store.create.mock.calls[0]?.[0].data.tokenHash);
    expect(consumed?.grant).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  });

  it("caps sessions at 7 days", () => {
    expect(STUDENT_PORTAL_SESSION_TTL_SECONDS).toBe(7 * 24 * 60 * 60);
    const token = createStudentPortalSessionToken({ vendorId: "vendor_1", customerKeyHash, grant, now });
    expect(readStudentPortalSessionToken(token, now)?.expiresAt).toEqual(new Date(now.getTime() + 7 * 24 * 60 * 60 * 1_000));
    expect(() => createStudentPortalSessionToken({ vendorId: "vendor_1", customerKeyHash, grant, now, ttlSeconds: 7 * 24 * 60 * 60 + 1 })).toThrow();
    expect(() => createStudentPortalSessionToken({ vendorId: "vendor_1", customerKeyHash, grant: "not-a-digest", now })).toThrow();
    // Encrypted under the current key, so only the lifetime bound can reject it.
    const thirtyDay = encryptWithRotation(JSON.stringify({
      version: "sp1", vendorId: "vendor_1", customerKeyHash, grant,
      issuedAt: Math.floor(now.getTime() / 1000), expiresAt: Math.floor(now.getTime() / 1000) + 30 * 24 * 60 * 60,
    }), DERIVED_KEY_ROTATIONS.studentPortalSession);
    expect(readStudentPortalSessionToken(thirtyDay, now)).toBeNull();
  });
});

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

import { encryptSensitiveValue } from "@/lib/sensitive-data";
import { DERIVED_KEY_ROTATIONS, encryptWithRotation } from "@/lib/derived-key-rotation";
describe("student portal temporal boundaries", () => {
  it("rejects future-issued access before touching consume state", async () => {
    const store = tokenStore();
    const token = await createStudentPortalAccessToken({ studentPortalAccessToken: store }, {
      vendorId: "vendor_1", email: "student@example.test", purpose: "magic_link", now: new Date(now.getTime() + 60_000),
    });
    expect(verifyStudentPortalAccessToken({ token, now })).toBeNull();
    await expect(consumeStudentPortalAccessToken({ studentPortalAccessToken: store }, { token, expectedPurpose: "magic_link", now })).resolves.toBeNull();
    expect(store.updateMany).not.toHaveBeenCalled();
  });
  it("rejects future-issued encrypted sessions", () => {
    const token = createStudentPortalSessionToken({ vendorId: "vendor_1", customerKeyHash, now: new Date(now.getTime() + 60_000) });
    expect(readStudentPortalSessionToken(token, now)).toBeNull();
  });
  it.each([0, -60])("rejects nonpositive session lifetime %s", (duration) => {
    const issuedAt = Math.floor(now.getTime() / 1000) + 120;
    const token = encryptSensitiveValue(JSON.stringify({ version: "sp1", vendorId: "vendor_1", customerKeyHash, issuedAt, expiresAt: issuedAt + duration }), "student-portal-session-v1");
    expect(readStudentPortalSessionToken(token, now)).toBeNull();
  });
});
