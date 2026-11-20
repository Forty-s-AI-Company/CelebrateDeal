import { expect, type Page } from "@playwright/test";
import type { PrismaClient } from "@prisma/client";
import { BETA_AGREEMENT_VERSION } from "../../../src/lib/beta-agreement-content";

/**
 * Accepts the agreement the way an owner does, with the keyboard only: the
 * dialog focuses the agreement text, End scrolls it to the last clause, Tab
 * reaches the checkbox, Space ticks it, Tab reaches 同意, Enter submits.
 */
export async function acceptBetaAgreementInBrowser(page: Page) {
  await expect(page).toHaveURL(/\/beta-agreement(?:\?|$)/u);
  const dialog = page.getByRole("dialog", { name: "CelebrateDeal 封測合作協議" });
  await expect(dialog).toBeVisible();
  const region = dialog.getByRole("region", { name: "協議全文" });
  const box = dialog.getByRole("checkbox", { name: /我已閱讀並同意《CelebrateDeal 封測合作協議》/u });
  const agree = dialog.getByRole("button", { name: "同意並進入後台" });
  await expect(region).toBeFocused();
  await expect(agree).toBeDisabled();
  if (await region.evaluate((element) => element.scrollHeight > element.clientHeight + 8)) await expect(box).toBeDisabled();
  await page.keyboard.press("End");
  await expect(box).toBeEnabled();
  await page.keyboard.press("Tab");
  await expect(box).toBeFocused();
  await page.keyboard.press("Space");
  await expect(box).toBeChecked();
  await expect(agree).toBeEnabled();
  await page.keyboard.press("Tab");
  await expect(agree).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).not.toHaveURL(/\/beta-agreement(?:\?|$)/u);
}

/**
 * Fixture data for specs that are not about the 封測合作協議 gate (O-11).
 *
 * Before an account signs in, records that each back-office vendor it belongs
 * to has already accepted the current agreement, as if that vendor's owner
 * had accepted it earlier. It writes the same `UserPolicyConsent` row the
 * gate's Server Action writes (context `beta_agreement`, the server's
 * current version, the vendor's earliest active owner, or this account when
 * the fixture vendor has no owner). The application still checks every
 * request; nothing here switches the gate off. The gate itself is covered by
 * `tests/e2e/beta-agreement.spec.ts`, which never calls this helper.
 *
 * An address with no account yet (registration, buyer or learner forms) is a
 * no-op.
 */
export async function seedBetaAgreementForLogin(db: PrismaClient, email: string) {
  const user = await db.user.findFirst({
    where: { email: { equals: email.trim(), mode: "insensitive" } },
    select: { id: true, memberships: { where: { status: "active", role: { not: "partner" } }, select: { vendorId: true } } },
  });
  if (!user) return;
  for (const { vendorId } of user.memberships) {
    const owner = await db.vendorMember.findFirst({
      where: { vendorId, role: "owner", status: "active" },
      orderBy: { createdAt: "asc" },
      select: { userId: true },
    });
    await db.userPolicyConsent.createMany({
      data: [{ userId: owner?.userId ?? user.id, vendorId, context: "beta_agreement", agreementVersion: BETA_AGREEMENT_VERSION }],
      skipDuplicates: true,
    });
  }
}
