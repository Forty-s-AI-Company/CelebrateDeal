import { describe, expect, it } from "vitest";
import {
  isVendorBackofficeRole,
  isVendorPartnerRole,
  PARTNER_PORTAL_PATH,
  signedInHomePath,
  VENDOR_BACKOFFICE_ROLES,
  vendorMemberRoleLabel,
} from "@/lib/vendor-roles";
import { VENDOR_MEMBER_ROLES } from "@/lib/vendor-member-invitation";

describe("vendor role boundary", () => {
  it("allows the merchant back office only for the four staff roles", () => {
    expect([...VENDOR_BACKOFFICE_ROLES]).toEqual(["owner", "admin", "accountant", "support"]);
    for (const role of VENDOR_BACKOFFICE_ROLES) expect(isVendorBackofficeRole(role)).toBe(true);
    // Default deny: partner, legacy or unknown roles and missing values.
    for (const role of ["partner", "member", "viewer", "manager", "platform_admin", "", "Owner", null, undefined]) {
      expect(isVendorBackofficeRole(role)).toBe(false);
    }
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

  it("sends each kind of account to its own home", () => {
    expect(signedInHomePath({ isPlatformAdmin: true, partnerPortalOnly: false })).toBe("/admin/billing/dashboard");
    expect(signedInHomePath({ isPlatformAdmin: false, partnerPortalOnly: true })).toBe(PARTNER_PORTAL_PATH);
    expect(signedInHomePath({ isPlatformAdmin: false, partnerPortalOnly: false })).toBe("/dashboard");
    expect(signedInHomePath({ isPlatformAdmin: false })).toBe("/dashboard");
    expect(PARTNER_PORTAL_PATH).toBe("/affiliate-portal");
  });
});
