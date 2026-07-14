"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { Megaphone, MessageCircle, Package, Send, ShoppingBag, Sparkles, UserRound } from "lucide-react";
import { LeadForm } from "@/components/lead-form";
import { formatCurrency } from "@/lib/format";
import { getOrCreateVisitorId } from "@/lib/visitor-id";

const clientHeaders = {
  "Content-Type": "application/json",
  "X-CelebrateDeal-Client": "web",
};

type LivePageData = {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  accentCopy: string | null;
  heroImageUrl: string | null;
  videoUrl: string | null;
  vendorId: string;
  brand: {
    name: string;
    logoUrl: string | null;
    primaryColor: string;
    ctaColor: string;
  };
  form: null | {
    id: string;
    headline: string;
    description: string | null;
    fields: Array<{ key: string; label: string; type?: string; required?: boolean }>;
    submitLabel: string;
    successMessage: string;
  };
  interactionEvents: Array<{
    id: string;
    eventType: string;
    triggerSec: number;
    title: string;
    message: string | null;
    productId: string | null;
    ctaLabel: string | null;
    ctaUrl: string | null;
    role: null | {
      name: string;
      avatarUrl: string | null;
      label: string;
      roleType: string;
    };
  }>;
  products: Array<{
    id: string;
    name: string;
    description: string | null;
    priceCents: number;
    compareAtCents: number | null;
    currency: string;
    imageUrl: string | null;
    checkoutUrl: string | null;
    offerLabel: string | null;
  }>;
};

type CheckoutResponse = {
  checkoutUrl?: string | null;
  formAction?: string;
  formMethod?: "POST";
  formPayload?: Record<string, string>;
};

function secondsLabel(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainSeconds = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainSeconds).padStart(2, "0")}`;
}

function submitCheckout(checkout: CheckoutResponse) {
  if (checkout.formAction && checkout.formPayload) {
    const form = document.createElement("form");
    form.method = checkout.formMethod ?? "POST";
    form.action = checkout.formAction;
    form.style.display = "none";

    for (const [name, value] of Object.entries(checkout.formPayload)) {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = name;
      input.value = value;
      form.appendChild(input);
    }

    document.body.appendChild(form);
    form.submit();
    return true;
  }

  if (checkout.checkoutUrl) {
    window.location.href = checkout.checkoutUrl;
    return true;
  }

  return false;
}

export function LivePlayback({ live }: { live: LivePageData }) {
  const [panel, setPanel] = useState<"chat" | "products" | "form">("chat");
  const [currentSeconds, setCurrentSeconds] = useState(0);
  const [reportedProgress, setReportedProgress] = useState<Set<number>>(() => new Set());
  const chatRef = useRef<HTMLDivElement>(null);
  const visitorId = useMemo(
    () => (typeof window === "undefined" ? "server" : getOrCreateVisitorId(() => crypto.randomUUID(), () => window.localStorage)),
    [],
  );
  const referralCode = useMemo(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("ref");
  }, []);

  const triggeredEvents = live.interactionEvents.filter((event) => event.triggerSec <= currentSeconds);
  const chatEvents = triggeredEvents.filter((event) => event.eventType === "chat_message" || event.eventType === "reminder");
  const latestProductEvent = [...triggeredEvents].reverse().find((event) => event.eventType === "product_spotlight" && event.productId);
  const latestCtaEvent = [...triggeredEvents].reverse().find((event) => event.eventType === "cta_switch" && event.ctaLabel);
  const spotlightProduct = live.products.find((product) => product.id === latestProductEvent?.productId) ?? live.products[0];
  const sortedProducts = spotlightProduct
    ? [...live.products].sort((a, b) => (a.id === spotlightProduct.id ? -1 : b.id === spotlightProduct.id ? 1 : 0))
    : live.products;

  useEffect(() => {
    void fetch("/api/analytics", {
      method: "POST",
      headers: clientHeaders,
      body: JSON.stringify({ liveId: live.id, vendorId: live.vendorId, visitorId, eventType: "page_view", payload: { slug: live.slug } }),
    });
  }, [live.id, live.slug, live.vendorId, visitorId]);

  useEffect(() => {
    if (!referralCode || typeof window === "undefined") return;
    void fetch("/api/affiliate-clicks", {
      method: "POST",
      headers: clientHeaders,
      body: JSON.stringify({
        liveId: live.id,
        vendorId: live.vendorId,
        visitorId,
        referralCode,
        landingPath: `${window.location.pathname}${window.location.search}`,
      }),
    });
  }, [live.id, live.vendorId, referralCode, visitorId]);

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: "smooth" });
  }, [chatEvents.length]);

  function trackProgress(seconds: number) {
    const checkpoint = [30, 60, 120, 300, 600].find((value) => seconds >= value && !reportedProgress.has(value));
    if (!checkpoint) return;
    const nextReported = new Set(reportedProgress);
    nextReported.add(checkpoint);
    setReportedProgress(nextReported);
    void fetch("/api/analytics", {
      method: "POST",
      headers: clientHeaders,
      body: JSON.stringify({ liveId: live.id, vendorId: live.vendorId, visitorId, eventType: "play_progress", payload: { seconds: checkpoint, ref: referralCode } }),
    });
  }

  async function trackProduct(productId: string, checkoutUrl: string | null) {
    await fetch("/api/analytics", {
      method: "POST",
      headers: clientHeaders,
      body: JSON.stringify({ liveId: live.id, vendorId: live.vendorId, visitorId, eventType: "product_click", payload: { productId, ref: referralCode } }),
    });

    const checkoutResponse = await fetch("/api/payments/checkout", {
      method: "POST",
      headers: clientHeaders,
      body: JSON.stringify({ vendorId: live.vendorId, productId, referralCode: referralCode ?? undefined }),
    });

    if (checkoutResponse.ok && submitCheckout(await checkoutResponse.json() as CheckoutResponse)) {
      return;
    }

    if (checkoutUrl) {
      window.location.href = checkoutUrl;
    }
  }

  async function trackCta() {
    if (!latestCtaEvent) return;
    await fetch("/api/analytics", {
      method: "POST",
      headers: clientHeaders,
      body: JSON.stringify({ liveId: live.id, vendorId: live.vendorId, visitorId, eventType: "cta_click", payload: { label: latestCtaEvent.ctaLabel, url: latestCtaEvent.ctaUrl, ref: referralCode } }),
    });
    if (latestCtaEvent.ctaUrl) {
      window.open(latestCtaEvent.ctaUrl, "_blank", "noopener,noreferrer");
    }
  }

  return (
    <main className="min-h-screen bg-slate-950">
      <section className="relative mx-auto min-h-screen max-w-[430px] overflow-hidden bg-slate-950 text-white shadow-2xl">
        <div className="absolute inset-0">
          {live.videoUrl ? (
            <video
              className="h-full w-full object-cover"
              src={live.videoUrl}
              controls
              playsInline
              poster={live.heroImageUrl ?? undefined}
              onTimeUpdate={(event) => {
                const seconds = Math.floor(event.currentTarget.currentTime);
                setCurrentSeconds(seconds);
                trackProgress(seconds);
              }}
              onPlay={() => {
                void fetch("/api/analytics", {
                  method: "POST",
                  headers: clientHeaders,
                  body: JSON.stringify({ liveId: live.id, vendorId: live.vendorId, visitorId, eventType: "video_play", payload: { slug: live.slug, ref: referralCode } }),
                });
              }}
            />
          ) : (
            <div className="h-full bg-cover bg-center" style={{ backgroundImage: live.heroImageUrl ? `url(${live.heroImageUrl})` : undefined }} />
          )}
          <div className="absolute inset-0 bg-gradient-to-b from-black/55 via-black/10 to-black/85" />
        </div>

        <header className="relative z-10 flex items-center justify-between gap-3 p-4">
          <div className="flex min-w-0 items-center gap-3 rounded-full bg-black/35 px-3 py-2 backdrop-blur-md">
            {live.brand.logoUrl ? <Image src={live.brand.logoUrl} alt="" width={34} height={34} unoptimized className="h-8 w-8 rounded-full object-cover" /> : null}
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-white/75">{live.brand.name}</p>
              <h1 className="truncate text-sm font-bold">{live.title}</h1>
            </div>
          </div>
          <div className="rounded-full bg-red-600 px-3 py-1 text-xs font-black tracking-wide shadow-lg shadow-red-950/40">LIVE</div>
        </header>

        <div className="relative z-10 flex min-h-[calc(100vh-72px)] flex-col justify-end p-4 pb-24">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-bold backdrop-blur-md">{secondsLabel(currentSeconds)}</span>
            {live.accentCopy ? <span className="rounded-full bg-orange-500/95 px-3 py-1 text-xs font-bold shadow-lg shadow-orange-950/30">{live.accentCopy}</span> : null}
          {referralCode ? <span className="rounded-full bg-blue-500/90 px-3 py-1 text-xs font-bold">來源 {referralCode}</span> : null}
          </div>

          {latestCtaEvent ? (
            <button onClick={trackCta} className="mb-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-orange-500 px-4 py-3 text-sm font-black text-white shadow-2xl shadow-orange-950/40">
              <Megaphone size={17} />
              {latestCtaEvent.ctaLabel}
            </button>
          ) : null}

          {spotlightProduct ? (
            <div className="mb-3 animate-[fadeInUp_260ms_ease-out] rounded-2xl border border-white/20 bg-white/95 p-3 text-slate-950 shadow-2xl">
              <div className="flex gap-3">
                {spotlightProduct.imageUrl ? <Image src={spotlightProduct.imageUrl} alt="" width={92} height={92} unoptimized className="h-20 w-20 rounded-xl object-cover" /> : null}
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-center gap-2">
                    <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-black text-orange-700">
                      {latestProductEvent ? "剛剛浮出" : "主打商品"}
                    </span>
                    {latestProductEvent ? <span className="text-xs text-slate-400">{secondsLabel(latestProductEvent.triggerSec)}</span> : null}
                  </div>
                  <h2 className="line-clamp-1 font-bold">{spotlightProduct.name}</h2>
                  <p className="mt-1 text-sm font-black text-orange-600">{formatCurrency(spotlightProduct.priceCents, spotlightProduct.currency)}</p>
                  <button onClick={() => trackProduct(spotlightProduct.id, spotlightProduct.checkoutUrl)} className="mt-2 h-9 w-full rounded-lg bg-orange-500 text-sm font-black text-white shadow-lg shadow-orange-200 hover:bg-orange-600">
                    立即搶購
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          <div ref={chatRef} className="max-h-56 space-y-2 overflow-hidden pr-1">
            {chatEvents.length === 0 ? (
              <div className="w-fit max-w-[88%] rounded-2xl bg-black/35 px-3 py-2 text-sm text-white/80 backdrop-blur-md">
                播放到指定秒數後，官方互動角色會自動帶節奏。
              </div>
            ) : null}
            {chatEvents.map((event) => (
              <div key={event.id} className="w-fit max-w-[92%] animate-[fadeInUp_220ms_ease-out] rounded-2xl bg-black/40 px-3 py-2 text-sm shadow-lg backdrop-blur-md">
                <div className="mb-1 flex items-center gap-2">
                  {event.role?.avatarUrl ? <Image src={event.role.avatarUrl} alt="" width={24} height={24} unoptimized className="h-6 w-6 rounded-full object-cover" /> : <UserRound size={18} />}
                  <span className="font-bold">{event.role?.name ?? "官方系統"}</span>
                  <span className="rounded-full bg-blue-500/90 px-2 py-0.5 text-[11px] font-black">{event.role?.label ?? "官方角色"}</span>
                </div>
                <p className="leading-5 text-white/90">{event.message}</p>
              </div>
            ))}
          </div>
        </div>

        <nav className="absolute bottom-0 left-0 right-0 z-20 border-t border-white/10 bg-black/55 px-3 py-3 backdrop-blur-xl">
          <div className="grid grid-cols-3 gap-2">
            {[
              ["chat", "聊天", MessageCircle],
              ["products", "商品", Package],
              ["form", "報名", Send],
            ].map(([key, label, Icon]) => (
              <button
                key={String(key)}
                onClick={() => setPanel(key as typeof panel)}
                className={`flex h-11 items-center justify-center gap-2 rounded-xl text-sm font-black transition ${
                  panel === key ? "bg-white text-slate-950 shadow-lg" : "bg-white/10 text-white"
                }`}
              >
                <Icon size={16} />
                {String(label)}
              </button>
            ))}
          </div>
        </nav>

        {panel !== "chat" ? (
          <aside className="absolute bottom-20 left-3 right-3 z-30 max-h-[58vh] overflow-auto rounded-2xl border border-white/15 bg-white p-4 text-slate-950 shadow-2xl">
            {panel === "products" ? (
              <div className="grid gap-3">
                <div className="flex items-center justify-between">
                  <h2 className="font-black">直播商品</h2>
                  <span className="rounded-full bg-orange-100 px-2 py-1 text-xs font-black text-orange-700">{live.products.length} 件</span>
                </div>
                {sortedProducts.map((product) => (
                  <article key={product.id} className={`rounded-xl border p-3 ${product.id === spotlightProduct?.id ? "border-orange-300 bg-orange-50" : "border-slate-200"}`}>
                    <div className="flex gap-3">
                      {product.imageUrl ? <Image src={product.imageUrl} alt="" width={84} height={84} unoptimized className="h-20 w-20 rounded-lg object-cover" /> : null}
                      <div className="min-w-0 flex-1">
                        <h3 className="line-clamp-1 font-bold">{product.name}</h3>
                        <p className="mt-1 line-clamp-2 text-xs text-slate-500">{product.description}</p>
                        <div className="mt-2 flex items-center justify-between gap-2">
                          <p className="font-black text-orange-600">{formatCurrency(product.priceCents, product.currency)}</p>
                          <button onClick={() => trackProduct(product.id, product.checkoutUrl)} className="inline-flex h-9 items-center gap-1 rounded-lg bg-orange-500 px-3 text-xs font-black text-white">
                            <ShoppingBag size={14} />
                            買
                          </button>
                        </div>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : null}

            {panel === "form" ? (
              live.form ? (
                <div>
                  <div className="mb-4 flex items-start gap-3">
                    <span className="grid h-10 w-10 place-items-center rounded-xl bg-blue-50 text-blue-700">
                      <Sparkles size={18} />
                    </span>
                    <div>
                      <h2 className="font-black">{live.form.headline}</h2>
                      {live.form.description ? <p className="mt-1 text-sm text-slate-500">{live.form.description}</p> : null}
                    </div>
                  </div>
                  <LeadForm formId={live.form.id} liveId={live.id} fields={live.form.fields} submitLabel={live.form.submitLabel} successMessage={live.form.successMessage} />
                </div>
              ) : (
                <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-500">這場直播尚未綁定報名表。</p>
              )
            ) : null}
          </aside>
        ) : null}
      </section>
    </main>
  );
}
