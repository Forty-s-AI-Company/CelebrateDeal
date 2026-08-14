import { afterEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { createFormSubmissionVerificationToken } from "@/lib/form-submission-verification";
import { verifyFormSubmission } from "@/lib/form-submission-verification-domain";

const createdVendorIds: string[] = [];

afterEach(async () => {
  await getDb().vendor.deleteMany({ where: { id: { in: createdVendorIds.splice(0) } } });
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
    });
    expect(await db.analyticsEvent.count({ where: { vendorId: vendor.id, eventType: "lead_submit" } })).toBe(1);
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
