import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: vi.fn(), set: vi.fn(), delete: vi.fn() }) }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));

import { issueCheckoutAdmission, verifyCheckoutAdmission } from "@/lib/checkout-admission";
import {
  DERIVED_KEY_ROTATIONS,
  ROTATION_EFFECTIVE_AT,
  acceptedLegacyPurpose,
  expiryFitsPreRotationIssue,
  issuedBeforeRotation,
  decryptWithRotation,
  encryptWithRotation,
  legacyDerivedKeyUseCount,
  macCandidatesWithRotation,
  recordLegacyDerivedKeyUse,
  resetLegacyDerivedKeyUseCounts,
  signWithRotation,
  verifyWithRotation,
  type DerivedKeyRotation,
} from "@/lib/derived-key-rotation";
import { createEmailUnsubscribeToken, verifyEmailUnsubscribeToken } from "@/lib/email-delivery-pii";
import { merchantInviteEmailHash } from "@/lib/merchant-registration-invite-records";
import { createFormSubmissionChatSessionToken, verifyFormSubmissionChatSessionToken } from "@/lib/form-submission-chat-session";
import { createFormSubmissionLineBindingToken, verifyFormSubmissionLineBindingToken } from "@/lib/form-submission-line-binding-session";
import { createFormSubmissionVerificationToken, verifyFormSubmissionVerificationToken } from "@/lib/form-submission-verification";
import { decodeLiveChatCursor, encodeLiveChatCursor } from "@/lib/live-chat";
import { createLiveViewerPass, verifyLiveViewerPass } from "@/lib/live-viewer-pass";
import { issuePostPurchaseCheckoutToken, verifyPostPurchaseCheckoutToken } from "@/lib/post-purchase-upsell";
import { verifyRegistrationResult } from "@/lib/registration-submission-receipt";
import { deriveSensitiveDataKey, encryptSensitiveValue } from "@/lib/sensitive-data";
import {
  createStudentPortalAccessToken,
  createStudentPortalSessionToken,
  readStudentPortalSessionToken,
  verifyStudentPortalAccessToken,
} from "@/lib/student-portal-auth";
import { ATTRIBUTION_COOKIE, attributionCookieFromRequest, encodeAttributionCookie } from "@/lib/team-funnel-attribution";

// Inside every tier 3 legacy window (the earliest hard stop is 2026-11-30 TW).
const IN_WINDOW = new Date("2026-11-01T00:00:00.000Z");
// After every hard stop.
const RETIRED = new Date("2028-01-01T00:00:00.000Z");
// Around ROTATION_EFFECTIVE_AT (2026-10-26T16:00:00Z).
const PRE_ROTATION = new Date("2026-10-25T12:00:00.000Z");
const POST_ROTATION = new Date("2026-10-26T17:00:00.000Z");
const AFTER_DEPLOY = new Date("2026-10-27T00:00:00.000Z");

/** Re-signs a "<signed value>.<mac>" token under another purpose, as the old code did. */
function resign(token: string, purpose: string) {
  const head = token.slice(0, token.lastIndexOf("."));
  return `${head}.${createHmac("sha256", deriveSensitiveDataKey(purpose)).update(head).digest("base64url")}`;
}

/** Flips one character of the MAC while keeping the token well formed. */
function tamper(token: string) {
  const last = token.at(-2) === "A" ? "B" : "A";
  return `${token.slice(0, -2)}${last}${token.at(-1)}`;
}

beforeEach(() => {
  vi.stubEnv("CSRF_SECRET", "synthetic-derived-key-rotation-root-0123456789");
  vi.stubEnv("JOB_SECRET", "");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.test");
  resetLegacyDerivedKeyUseCounts();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("rotation registry", () => {
  const rotations = Object.entries(DERIVED_KEY_ROTATIONS) as Array<[string, DerivedKeyRotation]>;

  it("gives every rotation a fresh, unguessable current purpose", () => {
    const currents = rotations.map(([, rotation]) => rotation.current);
    expect(new Set(currents).size).toBe(currents.length);
    const legacyNames = new Set(rotations.flatMap(([, rotation]) => rotation.legacy ? [rotation.legacy.purpose] : []));
    for (const [, rotation] of rotations) {
      expect(rotation.current).toMatch(/^[a-z0-9-]+:r2:[0-9a-f]{16}$/u);
      expect(legacyNames.has(rotation.current)).toBe(false);
      expect(rotation.current).not.toBe(rotation.label);
    }
  });

  it("bounds every legacy key: hard stops for tokens, re-encryption for data at rest", () => {
    for (const [name, rotation] of rotations) {
      if (!rotation.legacy) continue;
      if (name === "mfaEncryption" || name === "mfaRecoveryCode") {
        expect(rotation.legacy.acceptUntil).toBeNull();
        continue;
      }
      expect(rotation.legacy.acceptUntil, name).toBeInstanceOf(Date);
      expect(rotation.legacy.acceptUntil!.getTime(), name).toBeLessThanOrEqual(new Date("2027-11-01T00:00:00.000Z").getTime());
    }
  });

  it("keeps tier 2 rotations without a legacy key", () => {
    for (const name of [
      "csrfMac", "merchantRegistrationInvite", "merchantInviteEmailHash", "livePrivateChatConversationBinding", "checkoutAdmission", "formSubmissionLineBinding", "studentPortalAccessToken", "liveViewerPass",
      "liveChatCursor", "livePrivateChatCursor", "postPurchaseCheckout", "registrationSubmissionResult", "merchantEmailVerification",
      "accountEmailChange", "accountEmailRevert", "evergreenViewerSession", "liveSessionResult",
    ] as const) {
      expect(DERIVED_KEY_ROTATIONS[name].legacy, name).toBeNull();
    }
  });
});

describe("rotation helpers", () => {
  const rotation = DERIVED_KEY_ROTATIONS.emailUnsubscribe;

  it("prefers the current key and falls back to the legacy key until its hard stop", () => {
    const current = signWithRotation(rotation, "message");
    const legacy = createHmac("sha256", deriveSensitiveDataKey("email-delivery-unsubscribe")).update("message").digest("base64url");

    expect(verifyWithRotation(rotation, "message", current, IN_WINDOW)).toBe("current");
    expect(verifyWithRotation(rotation, "message", legacy, IN_WINDOW)).toBe("legacy");
    expect(verifyWithRotation(rotation, "message", legacy, RETIRED)).toBeNull();
    expect(verifyWithRotation(rotation, "other", current, IN_WINDOW)).toBeNull();
    expect(legacyDerivedKeyUseCount(rotation.label)).toBe(1);
    expect(acceptedLegacyPurpose(rotation, rotation.legacy!.acceptUntil!)).toBeNull();
    expect(macCandidatesWithRotation(rotation, "message", RETIRED).map((candidate) => candidate.version)).toEqual(["current"]);
  });

  it("decrypts legacy envelopes only while the legacy key is accepted", () => {
    const ticket = DERIVED_KEY_ROTATIONS.cloudflareUploadTicket;
    const legacy = encryptSensitiveValue("ticket", "cloudflare-resumable-upload-ticket");
    const current = encryptWithRotation("ticket", ticket);

    expect(decryptWithRotation(current, ticket, IN_WINDOW)).toEqual({ plaintext: "ticket", keyVersion: "current" });
    expect(decryptWithRotation(legacy, ticket, IN_WINDOW)).toEqual({ plaintext: "ticket", keyVersion: "legacy" });
    expect(() => decryptWithRotation(legacy, ticket, RETIRED)).toThrow();
    const [version, iv, tag, data] = current.split(".");
    const flippedTag = `${tag!.startsWith("A") ? "B" : "A"}${tag!.slice(1)}`;
    expect(() => decryptWithRotation([version, iv, flippedTag, data].join("."), ticket, IN_WINDOW)).toThrow();
    expect(legacyDerivedKeyUseCount(ticket.label)).toBe(1);
  });

  it("applies the issued-before-rotation check only after a legacy match, and never counts a refusal", () => {
    const legacy = createHmac("sha256", deriveSensitiveDataKey("email-delivery-unsubscribe")).update("message").digest("base64url");
    const predicate = vi.fn(() => false);

    expect(verifyWithRotation(rotation, "message", signWithRotation(rotation, "message"), IN_WINDOW, predicate)).toBe("current");
    expect(predicate).not.toHaveBeenCalled();
    expect(verifyWithRotation(rotation, "message", legacy, IN_WINDOW, predicate)).toBeNull();
    expect(predicate).toHaveBeenCalledOnce();
    expect(verifyWithRotation(rotation, "message", legacy, IN_WINDOW, () => true)).toBe("legacy");
    expect(legacyDerivedKeyUseCount(rotation.label)).toBe(1);

    const ticket = DERIVED_KEY_ROTATIONS.cloudflareUploadTicket;
    const envelope = encryptSensitiveValue("ticket", "cloudflare-resumable-upload-ticket");
    expect(() => decryptWithRotation(envelope, ticket, IN_WINDOW, () => false)).toThrow();
    expect(decryptWithRotation(envelope, ticket, IN_WINDOW, (plaintext) => plaintext === "ticket").keyVersion).toBe("legacy");
  });

  it("dates the rotation at 2026-10-27 00:00 Taiwan time", () => {
    expect(ROTATION_EFFECTIVE_AT.toISOString()).toBe("2026-10-26T16:00:00.000Z");
    expect(issuedBeforeRotation(ROTATION_EFFECTIVE_AT.getTime() - 1)).toBe(true);
    expect(issuedBeforeRotation(ROTATION_EFFECTIVE_AT.getTime())).toBe(false);
    expect(issuedBeforeRotation(Number.NaN)).toBe(false);
    expect(expiryFitsPreRotationIssue(ROTATION_EFFECTIVE_AT.getTime() + 1_000, 1_000)).toBe(true);
    expect(expiryFitsPreRotationIssue(ROTATION_EFFECTIVE_AT.getTime() + 1_001, 1_000)).toBe(false);
  });

  it("logs a legacy-key use with the fixed label only, at most once per interval", () => {
    vi.stubEnv("NODE_ENV", "production");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    recordLegacyDerivedKeyUse("email-delivery-unsubscribe");
    recordLegacyDerivedKeyUse("email-delivery-unsubscribe");

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("legacy_derived_key_used", { key: "email-delivery-unsubscribe", countSinceStart: 1 });
    expect(legacyDerivedKeyUseCount("email-delivery-unsubscribe")).toBe(2);
  });
});

describe("tier 2: short-lived tokens move to the new key and old ones are refused", () => {
  it("public checkout admission", () => {
    const now = new Date("2026-11-01T00:00:00.000Z");
    const issued = issueCheckoutAdmission({ vendorId: "vendor-1", productId: "product-1", productRevision: 3, now });
    const verify = (admissionToken: string) => verifyCheckoutAdmission({ admissionToken, sessionToken: issued.sessionToken, now });

    expect(verify(issued.admissionToken)).toMatchObject({ vendorId: "vendor-1", productId: "product-1" });
    expect(verify(resign(issued.admissionToken, "public-checkout-admission"))).toBeNull();
    expect(verify(tamper(issued.admissionToken))).toBeNull();
  });

  it("form submission LINE binding", () => {
    const now = new Date("2026-11-01T00:00:00.000Z");
    const token = createFormSubmissionLineBindingToken("submission-1", now);

    expect(verifyFormSubmissionLineBindingToken(token, now)).toMatchObject({ submissionId: "submission-1" });
    expect(verifyFormSubmissionLineBindingToken(resign(token, "form-submission-line-binding"), now)).toBeNull();
    expect(verifyFormSubmissionLineBindingToken(tamper(token), now)).toBeNull();
  });

  it("student portal access token", async () => {
    const now = new Date("2026-11-01T00:00:00.000Z");
    const token = await createStudentPortalAccessToken(
      { studentPortalAccessToken: { create: vi.fn().mockResolvedValue({}), updateMany: vi.fn() } },
      { vendorId: "vendor-1", email: "learner@example.test", purpose: "magic_link", now },
    );

    expect(verifyStudentPortalAccessToken({ token, now })).toMatchObject({ vendorId: "vendor-1", purpose: "magic_link" });
    expect(verifyStudentPortalAccessToken({ token: resign(token, "student-portal-access-token-v1"), now })).toBeNull();
    expect(verifyStudentPortalAccessToken({ token: tamper(token), now })).toBeNull();
  });

  it("live viewer pass", () => {
    const now = new Date("2026-11-01T00:00:00.000Z");
    const binding = { vendorId: "vendor-1", liveId: "live-1", admissionToken: "admission-token", now };
    const pass = createLiveViewerPass({ ...binding, viewerSessionId: "session-1", sessionExpiresAt: new Date(now.getTime() + 60_000) });

    expect(verifyLiveViewerPass(pass, binding)).toMatchObject({ viewerSessionId: "session-1" });
    expect(verifyLiveViewerPass(resign(pass, "live-viewer-pass"), binding)).toBeNull();
    expect(verifyLiveViewerPass(tamper(pass), binding)).toBeNull();
  });

  it("live chat cursor", () => {
    const cursor = encodeLiveChatCursor({ createdAt: new Date("2026-11-01T00:00:00.000Z"), id: "message-1" });

    expect(decodeLiveChatCursor(cursor)).toMatchObject({ id: "message-1" });
    expect(decodeLiveChatCursor(resign(cursor, "live-chat-cursor"))).toBeNull();
    expect(decodeLiveChatCursor(tamper(cursor))).toBeNull();
  });

  it("post-purchase checkout token, including the expired-replay path", () => {
    const now = new Date("2026-11-01T00:00:00.000Z");
    const token = issuePostPurchaseCheckoutToken({
      grantId: "grant-1", orderId: "order-1", vendorId: "vendor-1", sourceProductId: "product-1",
      productId: "product-2", kind: "upsell", amountCents: 19_500, now,
    });
    const legacy = resign(token, "post-purchase-checkout");

    expect(verifyPostPurchaseCheckoutToken(token, now)).toMatchObject({ grantId: "grant-1", amountCents: 19_500 });
    expect(verifyPostPurchaseCheckoutToken(legacy, now)).toBeNull();
    expect(verifyPostPurchaseCheckoutToken(legacy, now, { allowExpired: true })).toBeNull();
    expect(verifyPostPurchaseCheckoutToken(tamper(token), now)).toBeNull();
  });

  it("merchant invitation audit e-mail hash uses the rotated key", () => {
    const hashUnder = (purpose: string) => createHmac("sha256", deriveSensitiveDataKey(purpose)).update("owner@example.test").digest("base64url");

    expect(merchantInviteEmailHash(" Owner@Example.test ")).toBe(hashUnder("merchant-invite-email:r2:bcaa6cb59eb97af3"));
    expect(merchantInviteEmailHash("owner@example.test")).not.toBe(hashUnder("merchant-invite-email-v1"));
  });

  it("registration submission receipt", () => {
    const now = 1_793_491_200_000;
    const plaintext = JSON.stringify({ formId: "form-1", path: "/form/synthetic", expiresAt: now + 30_000 });
    const current = encryptSensitiveValue(plaintext, DERIVED_KEY_ROTATIONS.registrationSubmissionResult.current);
    const legacy = encryptSensitiveValue(plaintext, "registration-submission-result-v1");

    expect(verifyRegistrationResult(current, "form-1", "/form/synthetic", now)).toBe(true);
    expect(verifyRegistrationResult(legacy, "form-1", "/form/synthetic", now)).toBe(false);
  });
});

describe("tier 3: long-lived tokens sign with the new key and still accept the old one", () => {
  it("email unsubscribe links", () => {
    const token = createEmailUnsubscribeToken("delivery-1");
    const legacy = resign(token, "email-delivery-unsubscribe");

    expect(verifyEmailUnsubscribeToken(token, IN_WINDOW)).toBe("delivery-1");
    expect(legacyDerivedKeyUseCount("email-delivery-unsubscribe")).toBe(0);
    expect(verifyEmailUnsubscribeToken(legacy, IN_WINDOW)).toBe("delivery-1");
    expect(legacyDerivedKeyUseCount("email-delivery-unsubscribe")).toBe(1);
    expect(verifyEmailUnsubscribeToken(legacy, new Date("2027-10-30T00:00:00.000Z"))).toBe("delivery-1");
    expect(verifyEmailUnsubscribeToken(legacy, RETIRED)).toBeNull();
    expect(verifyEmailUnsubscribeToken(token, RETIRED)).toBe("delivery-1");
    expect(verifyEmailUnsubscribeToken(tamper(token), IN_WINDOW)).toBeNull();
    expect(verifyEmailUnsubscribeToken(resign(token, "another-purpose"), IN_WINDOW)).toBeNull();
  });

  it("form submission email verification links", () => {
    const ttl = 48 * 60 * 60 * 1_000;
    const create = (issuedAt: Date) => createFormSubmissionVerificationToken({
      submissionId: "submission-1", expiresAt: new Date(issuedAt.getTime() + ttl), version: 2,
    });
    const token = create(PRE_ROTATION);
    const legacy = resign(token, "form-submission-email-verification");

    expect(verifyFormSubmissionVerificationToken(token, AFTER_DEPLOY)).toMatchObject({ submissionId: "submission-1", version: 2 });
    expect(verifyFormSubmissionVerificationToken(legacy, AFTER_DEPLOY)).toMatchObject({ submissionId: "submission-1", version: 2 });
    expect(legacyDerivedKeyUseCount("form-submission-email-verification")).toBe(1);
    expect(verifyFormSubmissionVerificationToken(tamper(token), AFTER_DEPLOY)).toBeNull();

    // An expiry that a pre-rotation link cannot have: legacy key refused, current key fine.
    const postRotation = create(POST_ROTATION);
    expect(verifyFormSubmissionVerificationToken(postRotation, AFTER_DEPLOY)).not.toBeNull();
    expect(verifyFormSubmissionVerificationToken(resign(postRotation, "form-submission-email-verification"), AFTER_DEPLOY)).toBeNull();
    expect(legacyDerivedKeyUseCount("form-submission-email-verification")).toBe(1);

    const late = createFormSubmissionVerificationToken({ submissionId: "submission-1", expiresAt: new Date(RETIRED.getTime() + 60_000), version: 2 });
    expect(verifyFormSubmissionVerificationToken(late, RETIRED)).not.toBeNull();
    expect(verifyFormSubmissionVerificationToken(resign(late, "form-submission-email-verification"), RETIRED)).toBeNull();
  });

  it("form submission chat session cookies", () => {
    const token = createFormSubmissionChatSessionToken({ submissionId: "submission-1", now: PRE_ROTATION });
    const legacy = resign(token, "form-submission-chat-session");

    expect(verifyFormSubmissionChatSessionToken(token, AFTER_DEPLOY)).toMatchObject({ submissionId: "submission-1" });
    expect(verifyFormSubmissionChatSessionToken(legacy, AFTER_DEPLOY)).toMatchObject({ submissionId: "submission-1" });
    expect(legacyDerivedKeyUseCount("form-submission-chat-session")).toBe(1);
    expect(verifyFormSubmissionChatSessionToken(tamper(token), AFTER_DEPLOY)).toBeNull();

    const postRotation = createFormSubmissionChatSessionToken({ submissionId: "submission-1", now: POST_ROTATION });
    expect(verifyFormSubmissionChatSessionToken(postRotation, AFTER_DEPLOY)).not.toBeNull();
    expect(verifyFormSubmissionChatSessionToken(resign(postRotation, "form-submission-chat-session"), AFTER_DEPLOY)).toBeNull();
    expect(legacyDerivedKeyUseCount("form-submission-chat-session")).toBe(1);

    const late = createFormSubmissionChatSessionToken({ submissionId: "submission-1", now: RETIRED });
    expect(verifyFormSubmissionChatSessionToken(late, RETIRED)).not.toBeNull();
    expect(verifyFormSubmissionChatSessionToken(resign(late, "form-submission-chat-session"), RETIRED)).toBeNull();
  });

  it("team funnel attribution cookies", () => {
    const read = (cookie: string, now: Date) => attributionCookieFromRequest(
      new Request("https://app.example.test/", { headers: { cookie: `${ATTRIBUTION_COOKIE}=${cookie}` } }),
      now.getTime(),
    );
    const value = (issuedAt: Date) => ({ clickId: "click-1", visitorId: "visitor-0123456789abcdef", issuedAt: issuedAt.getTime() });
    const cookie = encodeAttributionCookie(value(PRE_ROTATION));
    const legacy = resign(cookie, "team-funnel-attribution-cookie");

    expect(read(cookie, AFTER_DEPLOY)).toMatchObject({ clickId: "click-1" });
    expect(read(legacy, AFTER_DEPLOY)).toMatchObject({ clickId: "click-1" });
    expect(legacyDerivedKeyUseCount("team-funnel-attribution-cookie")).toBe(1);
    expect(read(tamper(cookie), AFTER_DEPLOY)).toBeNull();

    const postRotation = encodeAttributionCookie(value(POST_ROTATION));
    expect(read(postRotation, AFTER_DEPLOY)).not.toBeNull();
    expect(read(resign(postRotation, "team-funnel-attribution-cookie"), AFTER_DEPLOY)).toBeNull();
    expect(legacyDerivedKeyUseCount("team-funnel-attribution-cookie")).toBe(1);

    const late = encodeAttributionCookie(value(RETIRED));
    expect(read(late, RETIRED)).not.toBeNull();
    expect(read(resign(late, "team-funnel-attribution-cookie"), RETIRED)).toBeNull();
  });

  it("student portal session cookies", () => {
    const customerKeyHash = "A".repeat(43);
    const legacyCookie = (issued: Date, ttlSeconds: number) => {
      const issuedAt = Math.floor(issued.getTime() / 1_000);
      return encryptSensitiveValue(JSON.stringify({ version: "sp1", vendorId: "vendor-1", customerKeyHash, issuedAt, expiresAt: issuedAt + ttlSeconds }), "student-portal-session-v1");
    };
    const current = createStudentPortalSessionToken({ vendorId: "vendor-1", customerKeyHash, now: PRE_ROTATION, ttlSeconds: 259_200 });

    expect(readStudentPortalSessionToken(current, AFTER_DEPLOY)).toMatchObject({ vendorId: "vendor-1" });
    expect(readStudentPortalSessionToken(legacyCookie(PRE_ROTATION, 259_200), AFTER_DEPLOY)).toMatchObject({ vendorId: "vendor-1" });
    expect(legacyDerivedKeyUseCount("student-portal-session")).toBe(1);
    // New cookies are not readable under the legacy key.
    expect(() => decryptWithRotation(current, { ...DERIVED_KEY_ROTATIONS.studentPortalSession, current: "student-portal-session-v1" }, RETIRED)).toThrow();

    // A legacy-key cookie claiming to be issued after the rotation is refused.
    expect(readStudentPortalSessionToken(legacyCookie(POST_ROTATION, 259_200), AFTER_DEPLOY)).toBeNull();
    expect(legacyDerivedKeyUseCount("student-portal-session")).toBe(1);
    expect(readStudentPortalSessionToken(legacyCookie(RETIRED, 3_600), RETIRED)).toBeNull();
  });
});
