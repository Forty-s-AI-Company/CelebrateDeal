import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookieDelete: vi.fn(),
  cookieGet: vi.fn(),
  cookieSet: vi.fn(),
  redirect: vi.fn(),
  vendorFindFirst: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: mocks.cookieGet, set: mocks.cookieSet, delete: mocks.cookieDelete }),
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    vendor: { findFirst: mocks.vendorFindFirst },
    studentPortalAccessToken: { create: vi.fn(), updateMany: vi.fn() },
  }),
}));

import {
  STUDENT_PORTAL_ACCESS_TOKEN_TTL_SECONDS,
  STUDENT_PORTAL_SESSION_COOKIE,
  clearStudentPortalSessionCookie,
  consumeStudentPortalAccessToken,
  createStudentPortalAccessToken,
  createStudentPortalSessionToken,
  readStudentPortalSessionToken,
  requireStudentPortalSession,
  setStudentPortalSessionCookie,
  studentPortalSessionCookieOptions,
  verifyStudentPortalAccessToken,
} from "@/lib/student-portal-auth";

const now = new Date("2026-09-09T08:00:00.000Z");
const customerKeyHash = "a".repeat(43);

function tokenStore() {
  return { create: vi.fn().mockResolvedValue({}), updateMany: vi.fn().mockResolvedValue({ count: 1 }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CSRF_SECRET", "student-portal-auth-test-secret-at-least-thirty-two-bytes");
  mocks.redirect.mockImplementation((path: string) => { throw new Error(`redirect:${path}`); });
  mocks.cookieGet.mockReturnValue(undefined);
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
    const token = createStudentPortalSessionToken({ vendorId: "vendor_1", customerKeyHash, now, ttlSeconds: 60 });
    expect(token).not.toContain("vendor_1");
    expect(readStudentPortalSessionToken(token, now)).toEqual({
      vendorId: "vendor_1",
      customerKeyHash,
      issuedAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
    });
    expect(readStudentPortalSessionToken(`${token}x`, now)).toBeNull();
    expect(readStudentPortalSessionToken(token, new Date(now.getTime() + 61_000))).toBeNull();
  });

  it("writes an HttpOnly scoped cookie and verifies the slug belongs to the session vendor", async () => {
    await setStudentPortalSessionCookie({ vendorId: "vendor_1", customerKeyHash });
    expect(mocks.cookieSet).toHaveBeenCalledWith(
      STUDENT_PORTAL_SESSION_COOKIE,
      expect.any(String),
      studentPortalSessionCookieOptions(),
    );

    mocks.cookieGet.mockReturnValue({ value: createStudentPortalSessionToken({ vendorId: "vendor_1", customerKeyHash, now }) });
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
  });

  it("redirects unauthenticated portal visitors to only that vendor's login", async () => {
    await expect(requireStudentPortalSession("acme")).rejects.toThrow("redirect:/portal/acme/login");
    expect(mocks.vendorFindFirst).not.toHaveBeenCalled();
  });
});
