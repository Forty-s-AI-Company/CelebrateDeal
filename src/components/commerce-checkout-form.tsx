"use client";

import { LoaderCircle, LockKeyhole, PackageCheck } from "lucide-react";
import Link from "next/link";
import { type FormEvent, useEffect, useRef, useState } from "react";
import {
  CommerceCheckoutAdmissionResponseSchema,
  checkoutErrorMessage,
  checkoutRequiresPhone,
  checkoutRequiresShipping,
  type CommerceCheckoutFulfillmentType,
  CommerceCheckoutResponseSchema,
  isAllowedCheckoutDestination,
  shouldDiscardCheckoutAdmission,
} from "@/lib/commerce-checkout";
import {
  clearCheckoutIdempotencyKey,
  getOrCreateCheckoutIdempotencyKey,
  readCheckoutIdempotencyKey,
} from "@/lib/checkout-idempotency";

type CheckoutPhase = "idle" | "submitting" | "redirecting" | "success" | "error";

type CommerceCheckoutFormProps = {
  vendorId: string;
  productId: string;
  productName: string;
  fulfillmentType: CommerceCheckoutFulfillmentType;
  recoveryOnly?: boolean;
};

function submitProviderForm(action: string, payload: Record<string, string>) {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = action;
  form.hidden = true;

  for (const [name, value] of Object.entries(payload)) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.append(input);
  }

  document.body.append(form);
  form.submit();
}

function fieldClassName() {
  return "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-950 shadow-sm placeholder:text-slate-400 focus:border-blue-500";
}

export function CommerceCheckoutForm({
  vendorId,
  productId,
  productName,
  fulfillmentType,
  recoveryOnly = false,
}: CommerceCheckoutFormProps) {
  const [phase, setPhase] = useState<CheckoutPhase>("idle");
  const [message, setMessage] = useState("");
  const [canCheckout, setCanCheckout] = useState(!recoveryOnly);
  const admission = useRef<{ admissionToken: string; idempotencyKey: string } | null>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const requiresShipping = checkoutRequiresShipping(fulfillmentType);
  const requiresPhone = checkoutRequiresPhone(fulfillmentType);
  const isPending = phase === "submitting" || phase === "redirecting";

  function checkoutIdempotencyKey() {
    try {
      return getOrCreateCheckoutIdempotencyKey(
        window.sessionStorage,
        vendorId,
        productId,
        () => window.crypto.randomUUID(),
      );
    } catch {
      // Storage can be unavailable in hardened browser modes. The in-memory
      // admission still protects retries within this mounted page.
      return window.crypto.randomUUID();
    }
  }

  function clearPersistedCheckoutIdentity() {
    try {
      clearCheckoutIdempotencyKey(window.sessionStorage, vendorId, productId);
    } catch {
      // A storage cleanup failure must not block a known checkout response.
    }
  }

  useEffect(() => {
    if (phase === "error" || phase === "success") statusRef.current?.focus();
  }, [phase]);

  useEffect(() => {
    if (!recoveryOnly) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      try {
        setCanCheckout(Boolean(readCheckoutIdempotencyKey(window.sessionStorage, vendorId, productId)));
      } catch {
        setCanCheckout(false);
      }
    });
    return () => { cancelled = true; };
  }, [productId, recoveryOnly, vendorId]);

  function markInputChanged() {
    if (phase === "error") {
      setPhase("idle");
      setMessage("");
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending || phase === "success") return;

    const form = event.currentTarget;
    const formData = new FormData(form);
    const text = (name: string) => String(formData.get(name) ?? "").trim();
    const buyer = {
      name: text("buyerName"),
      email: text("buyerEmail"),
      ...(text("buyerPhone") ? { phone: text("buyerPhone") } : {}),
    };
    const shipping = requiresShipping ? {
      recipientName: text("recipientName"),
      phone: text("shippingPhone"),
      countryCode: text("countryCode"),
      postalCode: text("postalCode"),
      administrativeArea: text("administrativeArea"),
      locality: text("locality"),
      addressLine1: text("addressLine1"),
      ...(text("addressLine2") ? { addressLine2: text("addressLine2") } : {}),
    } : null;

    setPhase("submitting");
    setMessage("正在確認商品與安全結帳資格，接著會建立訂單並保留庫存。");
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 30_000);

    try {
      if (!admission.current) {
        const idempotencyKey = checkoutIdempotencyKey();
        const admissionResponse = await fetch("/api/payments/checkout/admission", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-celebratedeal-client": "web",
          },
          body: JSON.stringify({ vendorId, productId, idempotencyKey }),
          signal: controller.signal,
        });
        if (!admissionResponse.ok) {
          setPhase("error");
          setMessage(checkoutErrorMessage(admissionResponse.status));
          return;
        }
        const parsedAdmission = CommerceCheckoutAdmissionResponseSchema.safeParse(await admissionResponse.json());
        if (!parsedAdmission.success || parsedAdmission.data.idempotencyKey !== idempotencyKey) {
          clearPersistedCheckoutIdentity();
          setPhase("error");
          setMessage("無法取得安全結帳憑證；尚未建立訂單，請稍後重試。");
          return;
        }
        admission.current = {
          admissionToken: parsedAdmission.data.admissionToken,
          idempotencyKey: parsedAdmission.data.idempotencyKey,
        };
      }

      const response = await fetch("/api/payments/checkout", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-celebratedeal-client": "web",
        },
        body: JSON.stringify({
          vendorId,
          productId,
          idempotencyKey: admission.current.idempotencyKey,
          admissionToken: admission.current.admissionToken,
          buyer,
          shipping,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        if (shouldDiscardCheckoutAdmission(response.status)) {
          admission.current = null;
          clearPersistedCheckoutIdentity();
        }
        setPhase("error");
        setMessage(checkoutErrorMessage(response.status));
        return;
      }

      const parsed = CommerceCheckoutResponseSchema.safeParse(await response.json());
      if (!parsed.success) {
        setPhase("error");
        setMessage("付款服務回應不完整；尚未向你收款，請稍後重試。");
        return;
      }

      const checkout = parsed.data;
      if (checkout.formAction && checkout.formMethod === "POST" && checkout.formPayload) {
        if (!isAllowedCheckoutDestination(checkout.formAction, window.location.origin, checkout.provider)) {
          setPhase("error");
          setMessage("付款服務目的地不安全；尚未向你收款，請聯絡客服。");
          return;
        }
        setPhase("redirecting");
        setMessage("訂單已建立，正在前往安全付款頁面。");
        admission.current = null;
        clearPersistedCheckoutIdentity();
        submitProviderForm(checkout.formAction, checkout.formPayload);
        return;
      }

      if (checkout.checkoutUrl) {
        if (!isAllowedCheckoutDestination(checkout.checkoutUrl, window.location.origin, checkout.provider)) {
          setPhase("error");
          setMessage("付款服務目的地不安全；尚未向你收款，請聯絡客服。");
          return;
        }
        setPhase("redirecting");
        setMessage("訂單已建立，正在前往安全付款頁面。");
        admission.current = null;
        clearPersistedCheckoutIdentity();
        window.location.assign(checkout.checkoutUrl);
        return;
      }

      admission.current = null;
      clearPersistedCheckoutIdentity();
      setPhase("success");
      setMessage(`訂單 ${checkout.orderNumber} 已建立；目前付款服務尚未要求進一步操作。`);
    } catch {
      setPhase("error");
      setMessage("連線逾時或暫時中斷；尚未向你收款，請重試。重試會沿用同一筆訂單，不會重複扣庫存。");
    } finally {
      window.clearTimeout(timeout);
    }
  }

  if (!canCheckout) {
    return (
      <div role="status" aria-live="polite" className="rounded-xl border border-orange-200 bg-orange-50 p-5 text-sm leading-6 text-orange-900">
        <p className="font-bold">目前已售完或名額已滿</p>
        <p className="mt-1">系統沒有建立新訂單，也不會進入付款。請回到活動頁查看其他商品。</p>
      </div>
    );
  }

  return (
    <form
      className="grid gap-6"
      onSubmit={handleSubmit}
      onInput={markInputChanged}
      aria-busy={isPending}
      aria-describedby="checkout-payment-notice checkout-live-status"
    >
      <fieldset className="grid gap-4" disabled={isPending || phase === "success"}>
        <legend className="text-lg font-bold text-slate-950">聯絡資料</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-semibold text-slate-800">
            姓名
            <input name="buyerName" autoComplete="name" required maxLength={120} className={fieldClassName()} />
          </label>
          <label className="text-sm font-semibold text-slate-800">
            Email
            <input name="buyerEmail" type="email" inputMode="email" autoComplete="email" required maxLength={320} className={fieldClassName()} />
          </label>
        </div>
        <label className="text-sm font-semibold text-slate-800">
          電話{requiresPhone ? "" : "（選填）"}
          <input name="buyerPhone" type="tel" inputMode="tel" autoComplete="tel" required={requiresPhone} maxLength={32} className={fieldClassName()} />
        </label>
      </fieldset>

      {requiresShipping ? (
        <fieldset className="grid gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4" disabled={isPending || phase === "success"}>
          <legend className="px-1 text-lg font-bold text-slate-950">收件資料</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-semibold text-slate-800">
              收件人
              <input name="recipientName" autoComplete="shipping name" required maxLength={120} className={fieldClassName()} />
            </label>
            <label className="text-sm font-semibold text-slate-800">
              收件電話
              <input name="shippingPhone" type="tel" inputMode="tel" autoComplete="shipping tel" required maxLength={32} className={fieldClassName()} />
            </label>
          </div>
          <div className="grid gap-4 sm:grid-cols-[120px_1fr_1fr]">
            <label className="text-sm font-semibold text-slate-800">
              國家
              <select name="countryCode" autoComplete="shipping country" defaultValue="TW" required className={fieldClassName()}>
                <option value="TW">台灣</option>
              </select>
            </label>
            <label className="text-sm font-semibold text-slate-800">
              縣市
              <input name="administrativeArea" autoComplete="shipping address-level1" required maxLength={120} className={fieldClassName()} />
            </label>
            <label className="text-sm font-semibold text-slate-800">
              鄉鎮市區
              <input name="locality" autoComplete="shipping address-level2" required maxLength={120} className={fieldClassName()} />
            </label>
          </div>
          <label className="text-sm font-semibold text-slate-800">
            郵遞區號（選填）
            <input name="postalCode" inputMode="numeric" autoComplete="shipping postal-code" maxLength={24} className={fieldClassName()} />
          </label>
          <label className="text-sm font-semibold text-slate-800">
            地址
            <input name="addressLine1" autoComplete="shipping address-line1" required maxLength={240} className={fieldClassName()} />
          </label>
          <label className="text-sm font-semibold text-slate-800">
            樓層、公司或其他補充（選填）
            <input name="addressLine2" autoComplete="shipping address-line2" maxLength={240} className={fieldClassName()} />
          </label>
        </fieldset>
      ) : null}

      <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm leading-6 text-blue-950">
        <p id="checkout-payment-notice" className="flex items-start gap-2 font-semibold">
          <LockKeyhole className="mt-0.5 shrink-0" size={18} aria-hidden="true" />
          CelebrateDeal 不會在這裡要求或保存卡號、有效期限與安全碼；下一步才會前往金流商的安全付款頁。
        </p>
      </div>

      <label className="flex items-start gap-3 text-sm leading-6 text-slate-700">
        <input type="checkbox" name="policyAcknowledgement" required className="mt-1 h-4 w-4 accent-blue-600" disabled={isPending || phase === "success"} />
        <span>
          我已閱讀目前的 <Link href="/policies/terms" className="font-semibold text-blue-700 underline">使用條款</Link>、
          <Link href="/policies/privacy" className="font-semibold text-blue-700 underline">隱私通知</Link> 與
          <Link href="/policies/refunds" className="font-semibold text-blue-700 underline">退款政策</Link>；這些文件在正式上線前仍需真人 owner 核准。
        </span>
      </label>

      <button
        type="submit"
        disabled={isPending || phase === "success"}
        aria-disabled={isPending || phase === "success"}
        aria-busy={isPending}
        className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-base font-bold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isPending ? <LoaderCircle className="animate-spin" size={20} aria-hidden="true" /> : <PackageCheck size={20} aria-hidden="true" />}
        {phase === "submitting" ? "正在建立訂單…" : phase === "redirecting" ? "正在前往付款…" : phase === "success" ? "訂單已建立" : `購買「${productName}」`}
      </button>

      <p
        ref={statusRef}
        id="checkout-live-status"
        role={phase === "error" ? "alert" : "status"}
        aria-live={phase === "error" ? "assertive" : "polite"}
        tabIndex={-1}
        className={`min-h-6 rounded-lg px-3 py-2 text-sm font-semibold outline-none ${
          phase === "error"
            ? "bg-red-50 text-red-800"
            : phase === "success"
              ? "bg-emerald-50 text-emerald-800"
              : message
                ? "bg-slate-100 text-slate-700"
                : "bg-transparent text-transparent"
        }`}
      >
        {message || "尚未送出"}
      </p>
    </form>
  );
}
