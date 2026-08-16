import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db";
import { createFormSubmissionVerificationToken } from "@/lib/form-submission-verification";
import { verifyFormSubmission } from "@/lib/form-submission-verification-domain";

const createdVendorIds: string[] = [];

beforeEach(() => {
  vi.stubEnv("CSRF_SECRET", "form-verification-disposable-test-secret-longer-than-thirty-two-bytes");
});

afterEach(async () => {
  await getDb().vendor.deleteMany({ where: { id: { in: createdVendorIds.splice(0) } } });
  vi.unstubAllEnvs();
});

async function createFixture(suffix: string) {
  const db = getDb();
  const vendor = await db.vendor.create({
    data: {
      name: `G7-13B form verification ${suffix}`,
      slug: `g7-13b-form-${suffix}`,
      email: `g7-13b-form-${suffix}@example.test`,
      passwordHash: "disposable-test-only",
    },
  });
  createdVendorIds.push(vendor.id);
  const form = await db.registrationForm.create({
    data: {
      vendorId: vendor.id,
      name: "Verification fixture",
      slug: `g7-13b-registration-${suffix}`,
      headline: "Verify registration",
      fields: [
        { key: "name", label: "Name", type: "text", required: true },
        { key: "email", label: "Email", type: "email", required: true },
      ],
    },
  });
  const live = await db.live.create({
    data: {
      vendorId: vendor.id,
      formId: form.id,
      title: "Verification live",
      slug: `g7-13b-live-${suffix}`,
      scheduledAt: new Date("2026-08-09T00:00:00.000Z"),
      status: "live",
    },
  });
  const affiliate = await db.affiliate.create({
    data: {
      vendorId: vendor.id,
      name: "Verified affiliate",
      code: `g7-13b-aff-${suffix}`,
    },
  });
  const click = await db.affiliateClick.create({
    data: {
      vendorId: vendor.id,
      affiliateId: affiliate.id,
      liveId: live.id,
      referralCode: affiliate.code,
      visitorId: `visitor-${suffix}`,
      landingPath: `/live/${live.slug}`,
    },
  });
  return { db, vendor, form, live, click };
}

describe("form submission verification disposable database invariants", () => {
  it("atomically verifies once and creates one trusted lead plus one affiliate conversion", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const { db, vendor, form, live, click } = await createFixture(suffix);
    const now = new Date();
    const expiresAt = new Date(Math.floor((now.getTime() + 60 * 60 * 1_000) / 1_000) * 1_000 + 731);
    const submission = await db.formSubmission.create({
      data: {
        formId: form.id,
        liveId: live.id,
        name: "Verified lead",
        email: `verified-${suffix}@example.test`,
        source: "live",
        verificationExpiresAt: expiresAt,
        affiliateClickId: click.id,
      },
    });
    const secondSubmission = await db.formSubmission.create({
      data: {
        formId: form.id,
        liveId: live.id,
        name: "Second verified lead",
        email: `verified-second-${suffix}@example.test`,
        source: "live",
        verificationExpiresAt: expiresAt,
        affiliateClickId: click.id,
      },
    });
    expect(secondSubmission.affiliateClickId).toBe(click.id);
    const token = createFormSubmissionVerificationToken({
      submissionId: submission.id,
      expiresAt,
      version: submission.verificationVersion,
    });

    await expect(verifyFormSubmission(db, token, now)).resolves.toMatchObject({
      status: "verified",
      confirmation: {
        vendorId: vendor.id,
        liveId: live.id,
        formSubmissionId: submission.id,
      },
    });
    await expect(db.formSubmission.findUniqueOrThrow({ where: { id: submission.id } })).resolves.toMatchObject({
      verificationStatus: "VERIFIED",
      verifiedAt: expect.any(Date),
    });
    const trustedLead = await db.analyticsEvent.findFirstOrThrow({
      where: { vendorId: vendor.id, liveId: live.id, eventType: "lead_submit" },
    });
    expect(trustedLead).toMatchObject({
      trustLevel: "VERIFIED_FORM_SUBMISSION",
      visitorId: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(trustedLead.visitorId).not.toContain("verified-");
    await expect(db.affiliateClick.findUniqueOrThrow({ where: { id: click.id } })).resolves.toMatchObject({
      convertedAt: expect.any(Date),
    });

    await expect(verifyFormSubmission(db, token, new Date(now.getTime() + 1_000))).resolves.toEqual({
      status: "already_verified",
      chatSession: { submissionId: submission.id },
    });
    expect(await db.analyticsEvent.count({ where: { vendorId: vendor.id, eventType: "lead_submit" } })).toBe(1);
  });

  it("only issues a chat session for an already-verified submission when token version and expiry are still current", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const { db, form } = await createFixture(suffix);
    const now = new Date("2026-08-17T00:00:00.000Z");
    const expiresAt = new Date("2026-08-18T00:00:00.000Z");
    const submission = await db.formSubmission.create({
      data: {
        formId: form.id,
        name: "Already verified lead",
        email: `already-${suffix}@example.test`,
        source: "form",
        verificationStatus: "VERIFIED",
        verifiedAt: now,
        verificationExpiresAt: expiresAt,
        verificationVersion: 3,
      },
    });
    const currentToken = createFormSubmissionVerificationToken({
      submissionId: submission.id,
      expiresAt,
      version: 3,
    });

    await expect(verifyFormSubmission(db, currentToken, now)).resolves.toEqual({
      status: "already_verified",
      chatSession: { submissionId: submission.id },
    });

    await db.formSubmission.update({
      where: { id: submission.id },
      data: { verificationVersion: 4 },
    });
    await expect(verifyFormSubmission(db, currentToken, now)).resolves.toEqual({ status: "invalid" });
  });

  it("does not issue a chat session for an already-verified submission after its current verification link expires", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const { db, form } = await createFixture(suffix);
    const now = new Date("2026-08-17T00:00:00.000Z");
    const expiredAt = new Date(now.getTime() - 1_000);
    const submission = await db.formSubmission.create({
      data: {
        formId: form.id,
        name: "Expired already verified lead",
        email: `expired-already-${suffix}@example.test`,
        source: "form",
        verificationStatus: "VERIFIED",
        verifiedAt: new Date(now.getTime() - 60_000),
        verificationExpiresAt: expiredAt,
        verificationVersion: 7,
      },
    });
    const expiredToken = createFormSubmissionVerificationToken({
      submissionId: submission.id,
      expiresAt: expiredAt,
      version: submission.verificationVersion,
    });

    await expect(verifyFormSubmission(db, expiredToken, now)).resolves.toEqual({ status: "invalid" });
  });

  it("does not issue a session for an unverified submission bound to another form's live", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const { db, vendor, form } = await createFixture(suffix);
    const wrongForm = await db.registrationForm.create({
      data: {
        vendorId: vendor.id,
        name: "Wrong live form",
        slug: `g7-13b-unverified-wrong-form-${suffix}`,
        headline: "Wrong live",
        fields: [
          { key: "name", label: "Name", type: "text", required: true },
          { key: "email", label: "Email", type: "email", required: true },
        ],
      },
    });
    const wrongLive = await db.live.create({
      data: {
        vendorId: vendor.id,
        formId: wrongForm.id,
        title: "Wrong live",
        slug: `g7-13b-unverified-wrong-live-${suffix}`,
        scheduledAt: new Date("2026-08-09T00:00:00.000Z"),
        status: "live",
      },
    });
    const now = new Date("2026-08-17T00:00:00.000Z");
    const expiresAt = new Date("2026-08-18T00:00:00.000Z");
    const submission = await db.formSubmission.create({
      data: {
        formId: form.id,
        liveId: wrongLive.id,
        name: "Unverified wrong live lead",
        email: `unverified-wrong-live-${suffix}@example.test`,
        source: "live",
        verificationExpiresAt: expiresAt,
      },
    });
    const token = createFormSubmissionVerificationToken({
      submissionId: submission.id,
      expiresAt,
      version: submission.verificationVersion,
    });

    await expect(verifyFormSubmission(db, token, now)).resolves.toEqual({ status: "invalid" });
    await expect(db.formSubmission.findUniqueOrThrow({ where: { id: submission.id } })).resolves.toMatchObject({
      verificationStatus: "UNVERIFIED",
      verifiedAt: null,
    });
  });

  it("does not issue a session for an already-verified submission bound to the wrong live and form", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const { db, vendor, form } = await createFixture(suffix);
    const wrongForm = await db.registrationForm.create({
      data: {
        vendorId: vendor.id,
        name: "Verified wrong live form",
        slug: `g7-13b-verified-wrong-form-${suffix}`,
        headline: "Wrong verified live",
        fields: [
          { key: "name", label: "Name", type: "text", required: true },
          { key: "email", label: "Email", type: "email", required: true },
        ],
      },
    });
    const wrongLive = await db.live.create({
      data: {
        vendorId: vendor.id,
        formId: wrongForm.id,
        title: "Verified wrong live",
        slug: `g7-13b-verified-wrong-live-${suffix}`,
        scheduledAt: new Date("2026-08-09T00:00:00.000Z"),
        status: "live",
      },
    });
    const now = new Date("2026-08-17T00:00:00.000Z");
    const expiresAt = new Date("2026-08-18T00:00:00.000Z");
    const submission = await db.formSubmission.create({
      data: {
        formId: form.id,
        liveId: wrongLive.id,
        name: "Already verified wrong live lead",
        email: `verified-wrong-live-${suffix}@example.test`,
        source: "live",
        verificationStatus: "VERIFIED",
        verifiedAt: new Date(now.getTime() - 60_000),
        verificationExpiresAt: expiresAt,
      },
    });
    const token = createFormSubmissionVerificationToken({
      submissionId: submission.id,
      expiresAt,
      version: submission.verificationVersion,
    });

    await expect(verifyFormSubmission(db, token, now)).resolves.toEqual({ status: "invalid" });
  });

  it("rejects expired or tampered claims without changing durable state", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const { db, vendor, form } = await createFixture(suffix);
    const expiresAt = new Date(Math.floor((Date.now() + 1_000) / 1_000) * 1_000);
    const submission = await db.formSubmission.create({
      data: {
        formId: form.id,
        name: "Unverified lead",
        email: `unverified-${suffix}@example.test`,
        verificationExpiresAt: expiresAt,
      },
    });
    const token = createFormSubmissionVerificationToken({ submissionId: submission.id, expiresAt, version: 1 });

    await expect(verifyFormSubmission(db, `${token.slice(0, -1)}x`, new Date(expiresAt.getTime() - 1))).resolves.toEqual({ status: "invalid" });
    await expect(verifyFormSubmission(db, token, new Date(expiresAt.getTime() + 1))).resolves.toEqual({ status: "invalid" });
    await expect(db.formSubmission.findUniqueOrThrow({ where: { id: submission.id } })).resolves.toMatchObject({
      verificationStatus: "UNVERIFIED",
      verifiedAt: null,
    });
    expect(await db.analyticsEvent.count({ where: { vendorId: vendor.id } })).toBe(0);
  });

  it("migrates legacy rows to honest UNVERIFIED defaults and excludes them from canonical counts", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const { db, form } = await createFixture(suffix);
    const legacyId = `legacy-${suffix}`;
    await db.$executeRaw`
      INSERT INTO "FormSubmission" ("id", "formId", "name", "email", "createdAt")
      VALUES (${legacyId}, ${form.id}, 'Legacy lead', ${`legacy-${suffix}@example.test`}, NOW())
    `;

    await expect(db.formSubmission.findUniqueOrThrow({ where: { id: legacyId } })).resolves.toMatchObject({
      verificationStatus: "UNVERIFIED",
      verificationVersion: 1,
      verificationExpiresAt: null,
      verifiedAt: null,
    });
    expect(await db.formSubmission.count({
      where: { formId: form.id, verificationStatus: "VERIFIED" },
    })).toBe(0);
  });
});
