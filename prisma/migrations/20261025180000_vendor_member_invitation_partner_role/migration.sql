-- Vendor partner role: an owner can invite a member as `partner`. Partners
-- never open the merchant back office; they use only the partner portal
-- (/affiliate-portal), where access is granted per affiliate through
-- AffiliatePortalAccess. VendorMember.role has no CHECK and already stores
-- `partner` in tests; only the invitation table restricts its role.
--
-- Forward-only and widening: the allowed set gains one value, so every
-- existing row still satisfies the new CHECK. VendorMemberInvitation holds a
-- bounded number of rows per vendor, so the validating scan is short.
SET LOCAL lock_timeout = '5s';

ALTER TABLE "VendorMemberInvitation" DROP CONSTRAINT "VendorMemberInvitation_role_check";
ALTER TABLE "VendorMemberInvitation"
  ADD CONSTRAINT "VendorMemberInvitation_role_check"
    CHECK ("role" IN ('owner', 'admin', 'accountant', 'support', 'partner'));
