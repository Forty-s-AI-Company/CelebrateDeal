"use client";

import { useState, type ComponentType } from "react";
import {
  AudioLines, BadgeDollarSign, Box, CalendarDays, ChevronLeft, ChevronRight, CircleDollarSign, CircleHelp, CirclePlus, ClipboardList, Code, Columns2, Columns3, Columns4,
  CreditCard, FileCheck2, FileText, GalleryHorizontal, Heading, House, Image as ImageIcon, LayoutTemplate, List, ListChecks, ListOrdered, Menu, MessageSquareQuote, Minus,
  MousePointerClick, Package, PanelBottom, PanelTop, Rows3, Search, Share2, ShieldCheck, ShoppingCart, SquareCheck, TextCursorInput, ThumbsUp, Ticket, Timer,
  Truck, Type, UserRound, Users, Video, Wallet,
} from "lucide-react";
import { getFunnelNodeDefinition, type FunnelNodeType } from "@/lib/funnel-page-document";
import { FUNNEL_BLOCK_CATEGORY_METADATA, getFunnelBlocksByCategory, type FunnelBlockCategory } from "@/lib/funnel-block-library";

type IconComponent = ComponentType<{ size?: number; "aria-hidden"?: boolean; className?: string }>;

export const FUNNEL_ELEMENT_DRAG_TYPE = "application/x-celebratedeal-funnel-element";
export const FUNNEL_BLOCK_DRAG_TYPE = "application/x-celebratedeal-funnel-block";

/** Editor palette: visible label and icon per node type (EDT-EL-001). */
export const FUNNEL_PALETTE: ReadonlyArray<{ type: FunnelNodeType; label: string; icon: IconComponent }> = [
  { type: "text", label: "文字", icon: Type }, { type: "headline", label: "標題", icon: Heading },
  { type: "bulleted_list", label: "項目清單", icon: List }, { type: "content_box", label: "內容盒", icon: Box },
  { type: "columns_4", label: "4 欄", icon: Columns4 }, { type: "columns_3", label: "3 欄", icon: Columns3 }, { type: "columns_2", label: "2 欄", icon: Columns2 },
  { type: "row", label: "欄列", icon: Rows3 }, { type: "section", label: "區段", icon: LayoutTemplate },
  { type: "form", label: "表單", icon: ClipboardList }, { type: "form_input", label: "表單欄位", icon: TextCursorInput }, { type: "button", label: "按鈕", icon: MousePointerClick },
  { type: "checkbox", label: "核取方塊", icon: SquareCheck }, { type: "survey", label: "問卷", icon: ListChecks }, { type: "calendar", label: "行事曆", icon: CalendarDays },
  { type: "recaptcha", label: "reCAPTCHA", icon: ShieldCheck },
  { type: "image", label: "圖片", icon: ImageIcon }, { type: "video", label: "影片", icon: Video }, { type: "audio", label: "音訊", icon: AudioLines }, { type: "carousel", label: "輪播", icon: GalleryHorizontal },
  { type: "x_share_button", label: "X 分享", icon: Share2 },
  { type: "countdown", label: "倒數計時", icon: Timer }, { type: "menu", label: "選單", icon: Menu }, { type: "horizontal_line", label: "水平線", icon: Minus },
  { type: "faq", label: "常見問題", icon: CircleHelp }, { type: "raw_html", label: "自訂 HTML", icon: Code },
  { type: "payment_button", label: "付款按鈕", icon: CreditCard }, { type: "payment_method", label: "付款方式", icon: Wallet }, { type: "offer_price", label: "方案價格", icon: BadgeDollarSign },
  { type: "physical_product", label: "實體商品", icon: Package }, { type: "customer_type", label: "客戶類型", icon: UserRound }, { type: "agreement", label: "同意條款", icon: FileCheck2 },
  { type: "order_bump", label: "加購方案", icon: CirclePlus }, { type: "two_step_order_form", label: "兩步驟結帳", icon: ListOrdered }, { type: "coupon", label: "優惠券狀態", icon: Ticket }, { type: "shipping_fees", label: "運費狀態", icon: Truck },
];

const paletteLabels = new Map(FUNNEL_PALETTE.map((item) => [item.type, item.label]));
/** Same label in the palette, breadcrumb and settings title. */
export function funnelNodeLabel(type: FunnelNodeType) {
  return paletteLabels.get(type) ?? getFunnelNodeDefinition(type).label;
}

const categories: ReadonlyArray<{ id: ReturnType<typeof getFunnelNodeDefinition>["category"]; label: string }> = [
  { id: "text", label: "文字" }, { id: "layout", label: "欄位版型" }, { id: "form", label: "表單" }, { id: "media", label: "媒體" },
  { id: "social", label: "社群" }, { id: "other", label: "其他" }, { id: "payment", label: "付款" },
];

function capabilityBadge(status: string) { return status === "limited" ? "功能未啟用" : "待驗證"; }

function PaletteTile({ item, disabled, onAdd }: { item: (typeof FUNNEL_PALETTE)[number]; disabled: boolean; onAdd: (type: FunnelNodeType) => void }) {
  const definition = getFunnelNodeDefinition(item.type);
  const capability = definition.capability;
  const unavailable = capability.status !== "available" && definition.category !== "payment";
  const Icon = item.icon;
  return <button type="button" data-palette-type={item.type} draggable={!disabled && !unavailable} disabled={disabled || unavailable} title={unavailable ? capability.reason : `點擊加入或拖曳到畫布：${item.label}`}
    onDragStart={(event) => { event.dataTransfer.effectAllowed = "copy"; event.dataTransfer.setData(FUNNEL_ELEMENT_DRAG_TYPE, item.type); }} onClick={() => onAdd(item.type)}
    className="flex min-h-[4.75rem] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-transparent bg-slate-100 p-2 text-center text-slate-700 transition-colors hover:border-blue-400 hover:bg-white hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 disabled:hover:border-transparent">
    <span className="grid h-8 w-8 place-items-center rounded-md bg-white text-slate-600 shadow-sm"><Icon size={18} aria-hidden /></span>
    <span className="text-xs font-semibold leading-4">{item.label}</span>
    {unavailable ? <span className="text-[10px] font-medium leading-3 text-amber-700">{capabilityBadge(capability.status)}</span> : null}
  </button>;
}

/** Elements tab: searchable icon grid grouped by systeme.io's categories. */
export function ElementLibrary({ disabled, onAdd }: { disabled: boolean; onAdd: (type: FunnelNodeType) => void }) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLocaleLowerCase("zh-TW");
  const visible = FUNNEL_PALETTE.filter((item) => `${item.label} ${item.type}`.toLocaleLowerCase("zh-TW").includes(needle));
  return <div className="grid gap-4">
    <label className="relative block"><span className="sr-only">搜尋元件</span>
      <Search size={16} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" />
      <input type="search" aria-label="搜尋元件" value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="搜尋元件" className="min-h-10 w-full rounded-lg border border-slate-300 bg-white py-2 pr-3 pl-9 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100" />
    </label>
    {categories.map((category) => {
      const items = visible.filter((item) => getFunnelNodeDefinition(item.type).category === category.id);
      if (!items.length) return null;
      return <section key={category.id} aria-labelledby={`funnel-palette-${category.id}`}>
        <h3 id={`funnel-palette-${category.id}`} className="mb-2 text-sm font-bold text-slate-900">{category.label}</h3>
        <div className="grid grid-cols-3 gap-2">{items.map((item) => <PaletteTile key={item.type} item={item} disabled={disabled} onAdd={onAdd} />)}</div>
      </section>;
    })}
    {!visible.length ? <p className="py-6 text-center text-sm text-slate-500">找不到符合的元件。</p> : null}
  </div>;
}

const blockIcons: Record<FunnelBlockCategory, IconComponent> = {
  order_forms: ShoppingCart, opt_in_forms: FileText, features: ThumbsUp, page_footers: PanelBottom, team_presentation: Users,
  welcome: House, price_plans: CircleDollarSign, page_headers: PanelTop, testimonials: MessageSquareQuote,
};

/** Blocks tab: category list first, then that category's blocks (EDT-BLK-001). */
export function BlockLibrary({ disabled, onAdd }: { disabled: boolean; onAdd: (templateId: string) => void }) {
  const [category, setCategory] = useState<FunnelBlockCategory | null>(null);
  const available = (Object.keys(FUNNEL_BLOCK_CATEGORY_METADATA) as FunnelBlockCategory[]).filter((id) => getFunnelBlocksByCategory(id).length > 0);
  if (!category) return <ul className="grid gap-1" aria-label="版型區塊分類">{available.map((id) => {
    const Icon = blockIcons[id];
    const meta = FUNNEL_BLOCK_CATEGORY_METADATA[id];
    return <li key={id}><button type="button" onClick={() => setCategory(id)} className="flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-lg px-3 text-left text-sm font-semibold text-slate-800 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400">
      <Icon size={18} aria-hidden className="shrink-0 text-slate-500" /><span className="min-w-0 flex-1">{meta.label}<span className="block truncate text-xs font-normal text-slate-500">{meta.description}</span></span><ChevronRight size={16} aria-hidden className="text-slate-400" />
    </button></li>;
  })}</ul>;
  const meta = FUNNEL_BLOCK_CATEGORY_METADATA[category];
  return <div className="grid gap-3">
    <div className="flex items-center gap-2"><button type="button" onClick={() => setCategory(null)} className="inline-flex min-h-9 cursor-pointer items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"><ChevronLeft size={16} aria-hidden />返回</button><h3 className="text-sm font-bold text-slate-900">{meta.label}</h3></div>
    {getFunnelBlocksByCategory(category).map((block) => <button key={block.id} type="button" draggable={!disabled} disabled={disabled} onDragStart={(event) => { event.dataTransfer.effectAllowed = "copy"; event.dataTransfer.setData(FUNNEL_BLOCK_DRAG_TYPE, block.id); }} onClick={() => onAdd(block.id)} className="cursor-pointer rounded-lg border border-slate-200 bg-white p-3 text-left shadow-sm hover:border-blue-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:cursor-not-allowed disabled:opacity-60">
      <span className="block text-sm font-bold text-slate-800">{block.label}</span>
      <span className="mt-1 block text-xs leading-5 text-slate-500">{block.description}</span>
      {block.capability ? <span className="mt-1 block text-[10px] font-semibold text-amber-700">付款需綁定商品；部分功能有限制</span> : null}
    </button>)}
  </div>;
}

/** Left panel default view: 元件 / 版型區塊 tabs. */
export function EditorLibrary({ disabled, onAddElement, onAddBlock }: { disabled: boolean; onAddElement: (type: FunnelNodeType) => void; onAddBlock: (templateId: string) => void }) {
  const [tab, setTab] = useState<"elements" | "blocks">("elements");
  const tabClass = (active: boolean) => `min-h-9 flex-1 cursor-pointer rounded-md text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${active ? "bg-white text-slate-950 shadow-sm" : "text-slate-600 hover:text-slate-900"}`;
  return <div className="grid gap-4">
    <div role="tablist" aria-label="新增內容" className="flex gap-1 rounded-lg bg-slate-100 p-1">
      <button type="button" role="tab" id="funnel-library-elements-tab" aria-controls="funnel-library-panel" aria-selected={tab === "elements"} onClick={() => setTab("elements")} className={tabClass(tab === "elements")}>元件</button>
      <button type="button" role="tab" id="funnel-library-blocks-tab" aria-controls="funnel-library-panel" aria-selected={tab === "blocks"} onClick={() => setTab("blocks")} className={tabClass(tab === "blocks")}>版型區塊</button>
    </div>
    <div id="funnel-library-panel" role="tabpanel" aria-labelledby={tab === "elements" ? "funnel-library-elements-tab" : "funnel-library-blocks-tab"}>
      {tab === "elements" ? <ElementLibrary disabled={disabled} onAdd={onAddElement} /> : <BlockLibrary disabled={disabled} onAdd={onAddBlock} />}
    </div>
  </div>;
}
