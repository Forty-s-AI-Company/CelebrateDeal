import { describe, expect, it } from "vitest";
import {
  accountSecurityPath,
  isVendorBackofficeRole,
  isVendorPartnerRole,
  PARTNER_PORTAL_PATH,
  signedInHomePath,
  vendorMemberRoleLabel,
} from "@/lib/vendor-roles";
import { VENDOR_MEMBER_ROLES } from "@/lib/vendor-member-invitation";

describe("vendor role boundary", () => {
  it("keeps only partner (and a missing role) out of the merchant back office", () => {
    // Legacy and unknown roles keep the previous behaviour; role guards judge them.
    for (const role of ["owner", "admin", "accountant", "support", "member", "editor", "manager", "viewer"]) {
      expect(isVendorBackofficeRole(role)).toBe(true);
    }
    for (const role of ["partner", null, undefined]) expect(isVendorBackofficeRole(role)).toBe(false);
  });

  it("recognizes only the exact partner role", () => {
    expect(isVendorPartnerRole("partner")).toBe(true);
    for (const role of ["Partner", "support", "", null, undefined]) expect(isVendorPartnerRole(role)).toBe(false);
  });

  it("covers every invitable role with a back-office or partner classification and a label", () => {
    for (const role of VENDOR_MEMBER_ROLES) {
      expect(isVendorBackofficeRole(role) !== isVendorPartnerRole(role)).toBe(true);
      expect(vendorMemberRoleLabel(role)).not.toBe(role);
    }
    expect(vendorMemberRoleLabel("partner")).toBe("夥伴");
    expect(vendorMemberRoleLabel("legacy")).toBe("legacy");
  });

  it("sends each kind of account to the security page it can open", () => {
    expect(accountSecurityPath({ isPlatformAdmin: true })).toBe("/mfa/setup");
    expect(accountSecurityPath({ isPlatformAdmin: false, partnerPortalOnly: true })).toBe("/mfa/setup");
    expect(accountSecurityPath({ isPlatformAdmin: false, partnerPortalOnly: false })).toBe("/settings/security");
    expect(accountSecurityPath({ isPlatformAdmin: false })).toBe("/settings/security");
  });

  it("sends each kind of account to its own home", () => {
    expect(signedInHomePath({ isPlatformAdmin: true, partnerPortalOnly: false })).toBe("/admin/billing/dashboard");
    expect(signedInHomePath({ isPlatformAdmin: false, partnerPortalOnly: true })).toBe(PARTNER_PORTAL_PATH);
    expect(signedInHomePath({ isPlatformAdmin: false, partnerPortalOnly: false })).toBe("/dashboard");
    expect(signedInHomePath({ isPlatformAdmin: false })).toBe("/dashboard");
    expect(PARTNER_PORTAL_PATH).toBe("/affiliate-portal");
  });
});
