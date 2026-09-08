"use client";

import { useState } from "react";
import type { PricingTableBlock } from "@/lib/funnel-blocks-schema";

function price(value: number, currency: string) {
  return new Intl.NumberFormat("zh-TW", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
}

export function PricingTableBlockComponent({ settings }: { settings: PricingTableBlock["settings"] }) {
  const [openCardId, setOpenCardId] = useState<string | null>(null);
  const layoutClass = settings.layout === "carousel" ? "flex snap-x snap-mandatory gap-4 overflow-x-auto pb-4" : settings.layout === "three_column" ? "grid gap-4 lg:grid-cols-3" : "grid gap-4 md:grid-cols-2";
  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6" aria-label={settings.title ?? "方案價格"} data-layout={settings.layout}>
      {settings.title ? <h2 className="mb-8 text-center text-3xl font-black text-slate-950">{settings.title}</h2> : null}
      <div className={layoutClass}>
        {settings.cards.map((card) => <article key={card.id} className={`relative flex flex-col rounded-3xl bg-white p-6 shadow-lg ${settings.layout === "carousel" ? "min-w-[82%] snap-center sm:min-w-[360px]" : ""} ${card.isFeatured ? "border-2 border-orange-500 ring-4 ring-orange-100" : "border border-slate-200"}`}>
          {card.isFeatured ? <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-orange-500 px-4 py-1 text-xs font-black text-white">{card.badgeText}</span> : null}
          <h3 className="text-xl font-black text-slate-950">{card.name}</h3>
          {card.description ? <p className="mt-2 text-sm leading-6 text-slate-600">{card.description}</p> : null}
          <div className="mt-5">{card.originalPrice !== undefined ? <del className="mr-2 text-sm text-slate-400">{price(card.originalPrice, card.currency)}</del> : null}<strong className="text-3xl text-slate-950">{price(card.salePrice, card.currency)}</strong></div>
          <ul className="my-6 grid flex-1 gap-3">{card.features.map((feature) => <li key={feature} className="flex gap-2 text-sm text-slate-700"><span aria-hidden="true" className="font-black text-emerald-600">✓</span>{feature}</li>)}</ul>
          <div className="grid gap-2">
            {card.showBuyButton && card.checkoutUrl ? <a href={card.checkoutUrl} className="rounded-xl bg-slate-950 px-4 py-3 text-center text-sm font-bold text-white">{card.buyButtonLabel}</a> : null}
            {card.showMoreInfoButton ? card.moreInfoTarget ? <a href={card.moreInfoTarget} onClick={(event) => {
              if (!card.moreInfoTarget?.startsWith("#")) return;
              const target = document.querySelector(card.moreInfoTarget);
              if (!target) return;
              event.preventDefault();
              target.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
            }} className="rounded-xl border border-slate-300 px-4 py-3 text-center text-sm font-bold text-slate-800">{card.moreInfoButtonLabel}</a> : <button type="button" aria-expanded={openCardId === card.id} onClick={() => setOpenCardId((current) => current === card.id ? null : card.id)} className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-bold text-slate-800">{card.moreInfoButtonLabel}</button> : null}
          </div>
          {openCardId === card.id && card.moreInfoText ? <div role="region" className="mt-3 rounded-xl bg-slate-50 p-4 text-sm leading-6 text-slate-700">{card.moreInfoText}</div> : null}
        </article>)}
      </div>
    </section>
  );
}

export { PricingTableBlockComponent as PricingTableBlock };
