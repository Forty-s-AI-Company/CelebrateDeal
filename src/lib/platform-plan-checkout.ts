import { Prisma } from "@prisma/client";
import { cookies } from "next/headers";
import { auditSnapshot, requestAuditMeta } from "@/lib/audit";
import { requireVendorOwnerFinance } from "@/lib/auth";
import { assertServerActionSecurity } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import { getCanonicalAppUrl, isExplicitLocalE2eRuntime } from "@/lib/app-url";
import { getPaymentProvider } from "@/lib/payment-providers";
import {
  checkoutReadinessAllowsNewTransaction,
  checkoutSessionHasUsableDestination,
  type CheckoutSessionResult,
} from "@/lib/payment-providers/types";
import {
  capturePlatformReferralAttribution,
  PLATFORM_REFERRAL_COOKIE,
} from "@/lib/platform-referral";

const PLAN_CHANGE_MAX_ATTEMPTS = 3;
const DEFAULT_BILLING_PAYMENT_MODE = "platform";
const PLATFORM_BILLING_PURPOSE = "platform_subscription_checkout";
const PLATFORM_SUBSCRIPTION_SUPERSEDED_STATUS = "payment_superseded";

export type PlatformPlanCheckoutResult =
  | { kind: "redirect"; path: string }
  | { kind: "checkout"; transactionId: string; referral: boolean };

export function platformPlanCheckoutPath(result: PlatformPlanCheckoutResult) {
  if (result.kind === "redirect") return result.path;

  const params = new URLSearchParams({
    status: "checkout",
    transactionId: result.transactionId,
  });
  if (result.referral) params.set("referral", "1");
  return `/billing/plans?${params.toString()}`;
}

function platformPlanCheckoutIdempotencyKey(vendorId: string, planId: string) {
  return `platform-plan:v1:${vendorId}:${planId}`;
}

function metadataObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function platformSubscriptionIdFromMetadata(value: unknown) {
  const subscriptionId = metadataObject(value).platformSubscriptionId;
  return typeof subscriptionId === "string" && subscriptionId.trim() ? subscriptionId : null;
}

function billingPlanIdFromMetadata(value: unknown) {
  const planId = metadataObject(value).billingPlanId;
  return typeof planId === "string" && planId.trim() ? planId : null;
}

function hasStoredCheckoutSession(value: unknown) {
  const checkoutSession = metadataObject(metadataObject(value).checkoutSession);
  return typeof checkoutSession.provider === "string"
    && typeof checkoutSession.mode === "string"
    && typeof checkoutSession.nextAction === "string";
}

function formText(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function nextMonthlyReset(now: Date) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

function orderNumber() {
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `CD-${stamp}-${suffix}`;
}

function isSerializationConflict(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2034";
}

function checkoutSessionMetadata(session: CheckoutSessionResult) {
  return {
    provider: session.provider,
    mode: session.mode,
    ...(session.checkoutUrl ? { checkoutUrl: session.checkoutUrl } : {}),
    ...(session.formAction ? { formAction: session.formAction } : {}),
    ...(session.formMethod ? { formMethod: session.formMethod } : {}),
    ...(session.formPayload ? { formPayload: session.formPayload } : {}),
    nextAction: session.nextAction,
    externalRequired: session.externalRequired ?? false,
  } as Prisma.InputJsonObject;
}

async function failPlatformPlanCheckout(input: { transactionId: string; subscriptionId: string }) {
  await getDb().$transaction(async (tx) => {
    await tx.paymentTransaction.updateMany({
      where: { id: input.transactionId, status: "pending" },
      data: { status: "failed", checkoutIdempotencyKey: null },
    });
    // A checkout that never reached a trusted paid callback must not consume
    // the visitor's one-click referral attribution forever. The snapshot is
    // still immutable while the checkout is live; releasing it on a failed
    // attempt lets a later retry create a fresh subscription snapshot without
    // changing the one-click-per-successful-attempt constraint.
    await tx.platformReferralAttribution.deleteMany({
      where: { subscriptionId: input.subscriptionId },
    });
    await tx.vendorSubscription.updateMany({
      where: { id: input.subscriptionId, status: "pending_payment" },
      data: { status: "payment_failed" },
    });
  });
}

/**
 * Runs the tenant-scoped plan checkout mutation without choosing a transport.
 * Server Actions and the native same-origin route both use this function so
 * redirect handling cannot change the payment, idempotency, or authorization
 * semantics.
 */
export async function createPlatformPlanCheckout(formData: FormData): Promise<PlatformPlanCheckoutResult> {
  await assertServerActionSecurity(formData);
  const { vendor, member } = await requireVendorOwnerFinance("/billing/plans");
  const planId = formText(formData, "planId");

  if (!planId || planId.length > 64) {
    return { kind: "redirect", path: "/billing/plans?error=unavailable" };
  }

  const auditMeta = await requestAuditMeta();
  const referralCookieClickId = (await cookies()).get(PLATFORM_REFERRAL_COOKIE)?.value ?? null;
  const requestedReferralClickId = formText(formData, "platformReferralClickId") || null;
  // The form field is only a context clue. A direct visit must not inherit
  // an old HttpOnly cookie, and a forged field must match the current cookie
  // before the server validates the click against the database.
  const referralClickId = requestedReferralClickId && requestedReferralClickId === referralCookieClickId
    ? requestedReferralClickId
    : null;
  let provider: ReturnType<typeof getPaymentProvider>;
  try {
    provider = getPaymentProvider(process.env.PAYMENT_PROVIDER ?? "demo");
  } catch {
    return { kind: "redirect", path: "/billing/plans?error=provider_not_configured" };
  }

  for (let attempt = 1; attempt <= PLAN_CHANGE_MAX_ATTEMPTS; attempt += 1) {
    try {
      const selectedAt = new Date();
      const result = await getDb().$transaction(async (tx) => {
        // Prices, quotas and the vendor owner are always read server-side.
        // Client fields other than planId never influence the transaction.
        const plan = await tx.billingPlan.findFirst({
          where: { id: planId, isActive: true },
        });
        if (!plan) return { outcome: "unavailable" as const };

        const activeSubscriptions = await tx.vendorSubscription.findMany({
          where: { vendorId: vendor.id, status: "active" },
          orderBy: { startedAt: "desc" },
        });

        if (activeSubscriptions.length === 1 && activeSubscriptions[0]?.planId === plan.id) {
          await tx.vendorSubscription.updateMany({
            where: { vendorId: vendor.id, status: "pending_payment" },
            data: { status: PLATFORM_SUBSCRIPTION_SUPERSEDED_STATUS, endedAt: selectedAt },
          });
          return {
            outcome: "current" as const,
            plan,
            subscription: activeSubscriptions[0],
            transaction: null,
          };
        }

        const previousSubscription = activeSubscriptions[0];
        const requiresPayment = plan.monthlyPriceCents > 0;

        if (requiresPayment) {
          const checkoutIdempotencyKey = platformPlanCheckoutIdempotencyKey(vendor.id, plan.id);
          const existingCheckout = await tx.paymentTransaction.findUnique({
            where: {
              vendorId_checkoutIdempotencyKey: {
                vendorId: vendor.id,
                checkoutIdempotencyKey,
              },
            },
          });
          if (existingCheckout?.status === "pending") {
            const existingMetadata = metadataObject(existingCheckout.metadata);
            const existingSubscriptionId = platformSubscriptionIdFromMetadata(existingMetadata);
            const existingSubscription = existingSubscriptionId
              ? await tx.vendorSubscription.findUnique({
                  where: { id: existingSubscriptionId },
                  include: { plan: true },
                })
              : null;
            if (
              existingSubscription
              && existingSubscription.vendorId === vendor.id
              && existingSubscription.planId === plan.id
              && existingSubscription.status === "pending_payment"
              && billingPlanIdFromMetadata(existingMetadata) === plan.id
              && hasStoredCheckoutSession(existingMetadata)
            ) {
              return {
                outcome: "reuse" as const,
                plan,
                subscription: existingSubscription,
                transaction: existingCheckout,
              };
            }
            // A pending key with an invalid or mismatched server snapshot is
            // never silently reused or overwritten; fail closed instead.
            return { outcome: "conflict" as const };
          }
          if (existingCheckout) {
            // Terminal transactions no longer reserve the plan's retry key.
            // The provider order remains immutable and late callbacks still
            // resolve against that order without reopening the subscription.
            await tx.paymentTransaction.update({
              where: { id: existingCheckout.id },
              data: { checkoutIdempotencyKey: null },
            });
          }
        }

        if (requiresPayment) {
          try {
            if (!checkoutReadinessAllowsNewTransaction(
              provider.checkoutReadiness(),
              process.env.NODE_ENV,
              isExplicitLocalE2eRuntime(),
            )) {
              return { outcome: "provider_unavailable" as const };
            }
          } catch {
            return { outcome: "provider_unavailable" as const };
          }
        }

        // Selecting a new plan supersedes older pending plan changes. This is
        // the server-side ordering rule that prevents a late paid callback
        // from reactivating an abandoned, older checkout.
        await tx.vendorSubscription.updateMany({
          where: { vendorId: vendor.id, status: "pending_payment" },
          data: { status: PLATFORM_SUBSCRIPTION_SUPERSEDED_STATUS, endedAt: selectedAt },
        });

        const subscription = await tx.vendorSubscription.create({
          data: {
            vendorId: vendor.id,
            planId: plan.id,
            // Paid plan changes stay pending until a trusted paid webhook.
            // This preserves the previous active entitlement during checkout.
            paymentMode: previousSubscription?.paymentMode ?? DEFAULT_BILLING_PAYMENT_MODE,
            billingCycleDay: previousSubscription?.billingCycleDay ?? 5,
            status: requiresPayment ? "pending_payment" : "active",
            startedAt: selectedAt,
          },
        });

        if (referralClickId) {
          await capturePlatformReferralAttribution(tx, {
            clickId: referralClickId,
            subscriptionId: subscription.id,
            capturedAt: selectedAt,
          });
        }

        if (!requiresPayment) {
          await tx.vendorSubscription.updateMany({
            where: { vendorId: vendor.id, status: "active", id: { not: subscription.id } },
            data: { status: "ended", endedAt: selectedAt },
          });
          await tx.vendorUsageLimit.upsert({
            where: { vendorId: vendor.id },
            create: {
              vendorId: vendor.id,
              billingPlanId: plan.id,
              streamMinutesLimit: plan.includedStreamMinutes,
              storageMinutesLimit: plan.includedStorageMinutes,
              creditsLimit: plan.includedCredits,
              resetAt: nextMonthlyReset(selectedAt),
            },
            update: {
              billingPlanId: plan.id,
              streamMinutesLimit: plan.includedStreamMinutes,
              storageMinutesLimit: plan.includedStorageMinutes,
              creditsLimit: plan.includedCredits,
            },
          });
        }

        const transaction = requiresPayment
          ? await tx.paymentTransaction.create({
              data: {
                vendorId: vendor.id,
                providerName: provider.id,
                orderNumber: orderNumber(),
                paymentMode: DEFAULT_BILLING_PAYMENT_MODE,
                grossAmountCents: plan.monthlyPriceCents,
                netAmountCents: plan.monthlyPriceCents,
                currency: "TWD",
                status: "pending",
                checkoutIdempotencyKey: platformPlanCheckoutIdempotencyKey(vendor.id, plan.id),
                metadata: {
                  billingPurpose: PLATFORM_BILLING_PURPOSE,
                  platformSubscriptionId: subscription.id,
                  billingPlanId: plan.id,
                  billingPlanCode: plan.code,
                } as Prisma.InputJsonObject,
              },
            })
          : null;

        await tx.auditLog.create({
          data: {
            vendorId: vendor.id,
            actorId: member.id,
            actorLabel: member.role,
            action: requiresPayment ? "start_platform_subscription_checkout" : "select_billing_plan_free",
            targetType: "VendorSubscription",
            targetId: subscription.id,
            before: auditSnapshot({ subscriptions: activeSubscriptions }),
            after: auditSnapshot({
              subscription,
              transaction,
              plan: { id: plan.id, code: plan.code, monthlyPriceCents: plan.monthlyPriceCents },
            }),
            ipAddress: auditMeta.ipAddress,
            userAgent: auditMeta.userAgent,
          },
        });

        return {
          outcome: "changed" as const,
          plan,
          subscription,
          transaction,
        };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

      if (result.outcome === "unavailable") {
        return { kind: "redirect", path: "/billing/plans?error=unavailable" };
      }
      if (result.outcome === "current") {
        return { kind: "redirect", path: "/billing/plans?status=current" };
      }
      if (result.outcome === "conflict") {
        return { kind: "redirect", path: "/billing/plans?error=conflict" };
      }
      if (result.outcome === "provider_unavailable") {
        return { kind: "redirect", path: "/billing/plans?error=checkout" };
      }

      if (result.outcome === "reuse") {
        return {
          kind: "checkout",
          transactionId: result.transaction.id,
          referral: Boolean(referralClickId),
        };
      }

      if (!result.transaction) {
        return { kind: "redirect", path: "/billing/plans?status=changed" };
      }

      let checkoutSession: CheckoutSessionResult;
      try {
        checkoutSession = provider.createCheckoutSession
          ? await provider.createCheckoutSession({
              transaction: result.transaction,
              billingPlan: result.plan,
              vendor,
              appUrl: getCanonicalAppUrl(),
            })
          : {
              provider: provider.id,
              mode: "manual" as const,
              checkoutUrl: null,
              nextAction: "provider_checkout_adapter_pending",
              externalRequired: true,
            };
        if (!checkoutSessionHasUsableDestination(checkoutSession, provider.checkoutReadiness())) {
          throw new Error("Payment provider returned no usable checkout destination.");
        }
      } catch {
        await failPlatformPlanCheckout({
          transactionId: result.transaction.id,
          subscriptionId: result.subscription.id,
        });
        return { kind: "redirect", path: "/billing/plans?error=checkout" };
      }

      try {
        await getDb().paymentTransaction.update({
          where: { id: result.transaction.id },
          data: {
            metadata: {
              billingPurpose: PLATFORM_BILLING_PURPOSE,
              platformSubscriptionId: result.subscription.id,
              billingPlanId: result.plan.id,
              billingPlanCode: result.plan.code,
              checkoutSession: checkoutSessionMetadata(checkoutSession),
            } as Prisma.InputJsonObject,
          },
        });
      } catch {
        await failPlatformPlanCheckout({
          transactionId: result.transaction.id,
          subscriptionId: result.subscription.id,
        });
        return { kind: "redirect", path: "/billing/plans?error=checkout" };
      }

      return {
        kind: "checkout",
        transactionId: result.transaction.id,
        referral: Boolean(referralClickId),
      };
    } catch (error) {
      if (!isSerializationConflict(error)) {
        throw error;
      }
      if (attempt === PLAN_CHANGE_MAX_ATTEMPTS) {
        return { kind: "redirect", path: "/billing/plans?error=conflict" };
      }
    }
  }

  return { kind: "redirect", path: "/billing/plans?error=conflict" };
}
