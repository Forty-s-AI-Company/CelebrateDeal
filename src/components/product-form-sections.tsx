"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/** 商品表單的段落，依欄位語意排列；順序即畫面順序。 */
export const PRODUCT_FORM_SECTIONS = [
  { key: "basic", label: "基本資料", description: "買家在商品頁看到的名稱、網址、說明與主圖。" },
  { key: "pricing", label: "價格與庫存", description: "售價、原價與可售數量；平台目前只支援新台幣。" },
  { key: "delivery", label: "交付", description: "付款後如何把商品交給買家，課程商品還要設定分潤。" },
  { key: "checkout", label: "結帳與加購", description: "結帳時額外詢問的資料，以及付款後的加購與備選商品。" },
  { key: "advanced", label: "進階與上架", description: "外部結帳網址，以及決定商品是否開放販售。" },
] as const;

export type ProductFormSectionKey = (typeof PRODUCT_FORM_SECTIONS)[number]["key"];

/** 伺服器欄位名稱屬於哪一段；沒列到的欄位回到第一段。 */
const FIELD_SECTION: Record<string, ProductFormSectionKey> = {
  name: "basic", slug: "basic", description: "basic", imageUrl: "basic",
  price: "pricing", compareAt: "pricing", currency: "pricing", inventory: "pricing",
  courseContentOwnerMembershipId: "delivery", coursePromoterShareBps: "delivery",
  deliveryTitle: "delivery", deliveryUrl: "delivery", deliveryInstructions: "delivery", deliveryHostConfirmed: "delivery",
  checkoutUrl: "advanced",
};

export function sectionOfField(name: string): ProductFormSectionKey {
  return FIELD_SECTION[name] ?? "basic";
}

export function sectionId(key: ProductFormSectionKey) {
  return `product-section-${key}`;
}

export function sectionTitleId(key: ProductFormSectionKey) {
  return `product-section-${key}-title`;
}

export function sectionAnchor(key: ProductFormSectionKey) {
  return `#${sectionId(key)}`;
}

function prefersReducedMotion() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** 捲到段落並把焦點移到段落標題（標題 tabIndex=-1），讀屏與鍵盤使用者才會跟著到新位置。 */
export function jumpToSection(key: ProductFormSectionKey) {
  const section = document.getElementById(sectionId(key));
  const title = document.getElementById(sectionTitleId(key));
  if (!section) return;
  if (typeof section.scrollIntoView === "function") {
    section.scrollIntoView({ block: "start", behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }
  title?.focus({ preventScroll: true });
}

/** 依 IntersectionObserver 追蹤目前閱讀到哪一段；沒有 IntersectionObserver 時停在第一段。 */
export function useActiveSection(): [ProductFormSectionKey, (key: ProductFormSectionKey) => void] {
  const [active, setActive] = useState<ProductFormSectionKey>(PRODUCT_FORM_SECTIONS[0].key);
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const visible = new Set<ProductFormSectionKey>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const key = PRODUCT_FORM_SECTIONS.find((section) => sectionId(section.key) === (entry.target as HTMLElement).id)?.key;
        if (!key) continue;
        if (entry.isIntersecting) visible.add(key); else visible.delete(key);
      }
      // 取畫面順序中第一個落在觀察帶內的段落。
      const first = PRODUCT_FORM_SECTIONS.find((section) => visible.has(section.key));
      if (first) setActive(first.key);
    }, { rootMargin: "-10% 0px -60% 0px" });
    for (const section of PRODUCT_FORM_SECTIONS) {
      const element = document.getElementById(sectionId(section.key));
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, []);
  return [active, setActive];
}

function SectionLinks({ active, onSelect }: { active: ProductFormSectionKey; onSelect: (key: ProductFormSectionKey) => void }) {
  return (
    <ol className="grid gap-1">
      {PRODUCT_FORM_SECTIONS.map((section, index) => {
        const current = section.key === active;
        return (
          <li key={section.key}>
            <a
              href={sectionAnchor(section.key)}
              aria-current={current ? "location" : undefined}
              data-section-link={section.key}
              onClick={(event) => { event.preventDefault(); onSelect(section.key); }}
              className={`flex min-h-11 items-center gap-2 rounded-md border-l-4 px-3 py-2 text-sm font-medium transition-colors ${current ? "border-blue-600 bg-blue-50 text-blue-900" : "border-transparent text-slate-700 hover:bg-slate-50"}`}
            >
              <span aria-hidden="true" className="text-xs text-slate-500">{index + 1}</span>
              {section.label}
            </a>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * 段落導覽：桌機（lg 以上）固定在左側；手機收成頂部「跳到段落」選單。
 * 兩者都是一般錨點連結——沒有 JavaScript 時仍會跳到段落，有時則捲動並把焦點移到段落標題。
 */
export function ProductFormSectionNav({ active, onSelect }: { active: ProductFormSectionKey; onSelect: (key: ProductFormSectionKey) => void }) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const select = useCallback((key: ProductFormSectionKey) => {
    if (detailsRef.current) detailsRef.current.open = false;
    onSelect(key);
    jumpToSection(key);
  }, [onSelect]);
  const activeLabel = PRODUCT_FORM_SECTIONS.find((section) => section.key === active)?.label;
  return (
    <>
      <details ref={detailsRef} className="rounded-md border border-slate-200 bg-white lg:hidden" data-section-menu="">
        <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm font-semibold text-slate-900">
          <span>跳到段落</span>
          <span className="text-xs font-normal text-slate-600">目前：{activeLabel}</span>
        </summary>
        <nav aria-label="商品表單段落（手機）" className="border-t border-slate-200 p-2">
          <SectionLinks active={active} onSelect={select} />
        </nav>
      </details>
      <nav aria-label="商品表單段落" className="hidden lg:sticky lg:top-6 lg:block lg:self-start" data-section-nav="">
        <SectionLinks active={active} onSelect={select} />
      </nav>
    </>
  );
}

/** 一個段落：`<section>` 由 h2 命名，標題可程式聚焦（tabIndex=-1），後面接一句說明。 */
export function ProductFormSection({ sectionKey, children }: { sectionKey: ProductFormSectionKey; children: ReactNode }) {
  const meta = PRODUCT_FORM_SECTIONS.find((section) => section.key === sectionKey)!;
  return (
    <section id={sectionId(sectionKey)} aria-labelledby={sectionTitleId(sectionKey)} className="grid scroll-mt-6 gap-4">
      <header className="grid gap-1 border-b border-slate-200 pb-2">
        <h2
          id={sectionTitleId(sectionKey)}
          tabIndex={-1}
          className="rounded text-base font-semibold text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        >{meta.label}</h2>
        <p className="text-sm text-slate-600">{meta.description}</p>
      </header>
      {children}
    </section>
  );
}
