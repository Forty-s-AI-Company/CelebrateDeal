/**
 * Vendor membership roles and the boundary between the merchant back office
 * and the partner portal. Pure module: safe for server guards, libraries and
 * client components alike.
 *
 * Back-office access is an allowlist. A `partner` membership (and any role
 * this list does not name) never becomes the current vendor context, so
 * every merchant guard, page, Server Action and API route that relies on the
 * session's vendor or member denies it by default. Partners use only the
 * partner portal, which authorizes by user and AffiliatePortalAccess.
 */
export const VENDOR_BACKOFFICE_ROLES = ["owner", "admin", "accountant", "support"] as const;
export type VendorBackofficeRole = (typeof VENDOR_BACKOFFICE_ROLES)[number];

export const VENDOR_PARTNER_ROLE = "partner" as const;
export const PARTNER_PORTAL_PATH = "/affiliate-portal";

export function isVendorBackofficeRole(role: string | null | undefined): role is VendorBackofficeRole {
  return typeof role === "string" && (VENDOR_BACKOFFICE_ROLES as readonly string[]).includes(role);
}

export function isVendorPartnerRole(role: string | null | undefined) {
  return role === VENDOR_PARTNER_ROLE;
}

/** Where a signed-in account lands by default: platform back office, merchant back office or partner portal. */
export function signedInHomePath(auth: { isPlatformAdmin: boolean; partnerPortalOnly?: boolean }) {
  if (auth.isPlatformAdmin) return "/admin/billing/dashboard";
  return auth.partnerPortalOnly ? PARTNER_PORTAL_PATH : "/dashboard";
}

/** Display labels for vendor membership roles (invitation form, e-mail, accept page, member list). */
export const VENDOR_MEMBER_ROLE_LABELS: Readonly<Record<string, string>> = {
  owner: "Owner",
  admin: "Admin",
  accountant: "Accountant（財務）",
  support: "Support（客服）",
  partner: "夥伴",
};

export function vendorMemberRoleLabel(role: string) {
  return VENDOR_MEMBER_ROLE_LABELS[role] ?? role;
}
