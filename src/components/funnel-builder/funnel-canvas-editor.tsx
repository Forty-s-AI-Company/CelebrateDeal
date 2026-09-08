"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import { CarouselBlock } from "@/components/funnel-blocks/carousel-block";
import { CountdownTimerBlock } from "@/components/funnel-blocks/countdown-timer-block";
import { PricingTableBlock } from "@/components/funnel-blocks/pricing-table-block";
import { ConsultationBookingBlock } from "@/components/funnel-blocks/consultation-booking-block";
import type { FunnelBlock, FunnelPageBlocks } from "@/lib/funnel-blocks-schema";

type CanvasDevice = "desktop" | "mobile";
type AddableBlockType = Exclude<FunnelBlock["type"], "hero_banner">;

export type FunnelCanvasEditorProps = {
  formName: string;
  blocks: FunnelPageBlocks;
  pending?: boolean;
  onChange: (blocks: FunnelPageBlocks) => void;
  onUseTraditionalEditor: () => void;
};

const panelInput =
  "h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
const panelTextarea =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100";

function ordered(blocks: FunnelPageBlocks): FunnelPageBlocks {
  return [...blocks]
    .sort(
      (left, right) =>
        left.sortOrder - right.sortOrder || left.id.localeCompare(right.id),
    )
    .map((block, index) => ({ ...block, sortOrder: index }));
}

export function moveCanvasBlock(
  blocks: FunnelPageBlocks,
  id: string,
  direction: -1 | 1,
) {
  const next = ordered(blocks);
  const index = next.findIndex((block) => block.id === id);
  const destination = index + direction;
  if (index < 0 || destination < 0 || destination >= next.length) return next;
  [next[index], next[destination]] = [next[destination]!, next[index]!];
  return next.map((block, position) => ({ ...block, sortOrder: position }));
}

export function removeCanvasBlock(blocks: FunnelPageBlocks, id: string) {
  return ordered(blocks.filter((block) => block.id !== id));
}

function clientId(prefix: string) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

function defaultBlock(type: AddableBlockType, sortOrder: number): FunnelBlock {
  const id = clientId(type);
  if (type === "carousel_slider")
    return {
      id,
      type,
      sortOrder,
      isVisible: true,
      settings: {
        ariaLabel: "精選內容輪播",
        slides: [
          {
            id: clientId("slide"),
            imageUrl: "/images/funnel-templates/low-barrier-lead-magnet.svg",
            imageAlt: "輪播圖片",
            title: "新的輪播圖片",
          },
        ],
        autoPlay: true,
        intervalMs: 5000,
        showDots: true,
        showArrows: true,
      },
    };
  if (type === "pricing_table")
    return {
      id,
      type,
      sortOrder,
      isVisible: true,
      settings: {
        title: "選擇適合你的方案",
        layout: "two_column",
        cards: [0, 1].map((index) => ({
          id: clientId("plan"),
          name: `方案 ${index + 1}`,
          salePrice: 0,
          currency: "TWD",
          features: ["方案特色"],
          isFeatured: index === 1,
          badgeText: "熱門首選",
          showBuyButton: true,
          buyButtonLabel: "立即購買",
          checkoutUrl: "#registration",
          showMoreInfoButton: false,
          moreInfoButtonLabel: "了解更多",
        })),
      },
    };
  if (type === "countdown_timer")
    return {
      id,
      type,
      sortOrder,
      isVisible: true,
      settings: {
        title: "優惠倒數",
        mode: "evergreen_minutes",
        theme: "flip",
        evergreenMinutes: 15,
        expiredMessage: "優惠已結束",
      },
    };
  if (type === "lead_form")
    return {
      id,
      type,
      sortOrder,
      isVisible: true,
      settings: {
        title: "立即報名",
        variant: "inline",
        fieldKeys: ["name", "email"],
        submitLabel: "立即領取直播連結",
      },
    };
  if (type === "consultation_booking")
    return {
      id,
      type,
      sortOrder,
      isVisible: true,
      settings: {
        title: "預約諮詢",
        timezone: "Asia/Taipei",
        durationMinutes: 30,
        submitLabel: "送出預約",
        successMessage: "預約已送出，我們會依照你留下的資料與你聯繫。",
        intakeFields: [
          {
            id: "company",
            label: "想討論的主題",
            type: "textarea",
            required: false,
          },
        ],
      },
    };
  return {
    id,
    type,
    sortOrder,
    isVisible: true,
    settings: {
      title: "常見問題",
      items: [
        {
          id: clientId("faq"),
          question: "這裡可以放什麼？",
          answer: "輸入觀眾最常詢問的問題與答案。",
        },
      ],
    },
  };
}

export function resizePricingCards(
  block: Extract<FunnelBlock, { type: "pricing_table" }>,
  layout: "two_column" | "three_column" | "carousel",
) {
  const expected =
    layout === "two_column"
      ? 2
      : layout === "three_column"
        ? 3
        : block.settings.cards.length;
  const cards = [...block.settings.cards];
  while (cards.length < expected)
    cards.push({
      id: clientId("plan"),
      name: `方案 ${cards.length + 1}`,
      salePrice: 0,
      currency: "TWD",
      features: ["方案特色"],
      isFeatured: false,
      badgeText: "熱門首選",
      showBuyButton: true,
      buyButtonLabel: "立即購買",
      checkoutUrl: "#registration",
      showMoreInfoButton: false,
      moreInfoButtonLabel: "了解更多",
    });
  return {
    ...block,
    settings: {
      ...block.settings,
      layout,
      cards: layout === "carousel" ? cards : cards.slice(0, expected),
    },
  };
}

function BlockPreview({ block }: { block: FunnelBlock }) {
  if (block.type === "carousel_slider")
    return <CarouselBlock settings={block.settings} />;
  if (block.type === "pricing_table")
    return <PricingTableBlock settings={block.settings} />;
  if (block.type === "countdown_timer")
    return (
      <CountdownTimerBlock
        blockId={`editor-${block.id}`}
        settings={block.settings}
      />
    );
  if (block.type === "consultation_booking")
    return <ConsultationBookingBlock settings={block.settings} />;
  if (block.type === "hero_banner")
    return (
      <section className="relative isolate overflow-hidden bg-slate-950 px-6 py-20 text-white">
        {block.settings.imageUrl ? (
          <Image
            src={block.settings.imageUrl}
            alt={block.settings.imageAlt}
            fill
            unoptimized
            sizes="100vw"
            className="-z-20 object-cover"
          />
        ) : null}
        <div className="absolute inset-0 -z-10 bg-slate-950/65" />
        {block.settings.eyebrow ? (
          <p className="text-xs font-black uppercase tracking-widest text-orange-300">
            {block.settings.eyebrow}
          </p>
        ) : null}
        <h2 className="mt-2 text-4xl font-black">{block.settings.headline}</h2>
        {block.settings.description ? (
          <p className="mt-4 max-w-2xl text-slate-200">
            {block.settings.description}
          </p>
        ) : null}
      </section>
    );
  if (block.type === "lead_form")
    return (
      <section id="registration" className="mx-auto max-w-2xl px-5 py-10">
        <div className="rounded-3xl border bg-white p-6 shadow-lg">
          <h2 className="text-2xl font-black">
            {block.settings.title ?? "名單收集表單"}
          </h2>
          {block.settings.description ? (
            <p className="mt-2 text-sm text-slate-600">
              {block.settings.description}
            </p>
          ) : null}
          <div className="mt-5 grid gap-3">
            {block.settings.fieldKeys.map((key) => (
              <div
                key={key}
                className="h-11 rounded-lg border bg-slate-50 px-3 py-3 text-sm text-slate-400"
              >
                {key === "name" ? "姓名" : key === "email" ? "Email" : "手機"}
              </div>
            ))}
            <div className="rounded-lg bg-slate-950 px-4 py-3 text-center text-sm font-bold text-white">
              {block.settings.submitLabel ?? "送出"}
            </div>
          </div>
        </div>
      </section>
    );
  return (
    <section className="mx-auto max-w-4xl px-5 py-10">
      <h2 className="mb-4 text-2xl font-black">
        {block.settings.title ?? "常見問題"}
      </h2>
      {block.settings.items.map((item) => (
        <details key={item.id} className="mb-3 rounded-xl border bg-white p-4">
          <summary className="font-bold">{item.question}</summary>
          <p className="mt-2 text-sm text-slate-600">{item.answer}</p>
        </details>
      ))}
    </section>
  );
}

function Inspector({
  block,
  onChange,
}: {
  block: FunnelBlock;
  onChange: (block: FunnelBlock) => void;
}) {
  if (block.type === "pricing_table")
    return (
      <div className="grid gap-5">
        <fieldset>
          <legend className="mb-2 text-sm font-bold">價格卡版型</legend>
          {[
            ["two_column", "兩欄對比"],
            ["three_column", "三欄錨定"],
            ["carousel", "輪播滑動卡片"],
          ].map(([value, label]) => (
            <label key={value} className="mb-2 flex items-center gap-2 text-sm">
              <input
                type="radio"
                name={`layout-${block.id}`}
                checked={block.settings.layout === value}
                onChange={() =>
                  onChange(
                    resizePricingCards(
                      block,
                      value as typeof block.settings.layout,
                    ),
                  )
                }
              />
              {label}
            </label>
          ))}
        </fieldset>
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={block.settings.cards.every((card) => card.showBuyButton)}
            onChange={(event) =>
              onChange({
                ...block,
                settings: {
                  ...block.settings,
                  cards: block.settings.cards.map((card) => ({
                    ...card,
                    showBuyButton: event.target.checked,
                    checkoutUrl: event.target.checked
                      ? (card.checkoutUrl ?? "#registration")
                      : card.checkoutUrl,
                  })),
                },
              })
            }
          />
          顯示「立即購買」按鈕
        </label>
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={block.settings.cards.every(
              (card) => card.showMoreInfoButton,
            )}
            onChange={(event) =>
              onChange({
                ...block,
                settings: {
                  ...block.settings,
                  cards: block.settings.cards.map((card) => ({
                    ...card,
                    showMoreInfoButton: event.target.checked,
                    moreInfoText: event.target.checked
                      ? (card.moreInfoText ?? "請在此補充方案說明。")
                      : card.moreInfoText,
                  })),
                },
              })
            }
          />
          顯示「了解更多」按鈕
        </label>
        <div className="grid gap-4">
          {block.settings.cards.map((card, index) => (
            <fieldset
              key={card.id}
              className="grid gap-2 rounded-xl border p-3"
            >
              <legend className="px-1 text-sm font-bold">
                方案 {index + 1}
              </legend>
              <input
                aria-label={`方案 ${index + 1} 名稱`}
                className={panelInput}
                value={card.name}
                onChange={(event) =>
                  onChange({
                    ...block,
                    settings: {
                      ...block.settings,
                      cards: block.settings.cards.map((item) =>
                        item.id === card.id
                          ? { ...item, name: event.target.value }
                          : item,
                      ),
                    },
                  })
                }
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  aria-label={`方案 ${index + 1} 優惠價`}
                  type="number"
                  min="0"
                  className={panelInput}
                  value={card.salePrice}
                  onChange={(event) =>
                    onChange({
                      ...block,
                      settings: {
                        ...block.settings,
                        cards: block.settings.cards.map((item) =>
                          item.id === card.id
                            ? { ...item, salePrice: Number(event.target.value) }
                            : item,
                        ),
                      },
                    })
                  }
                />
                <input
                  aria-label={`方案 ${index + 1} 原價`}
                  type="number"
                  min="0"
                  className={panelInput}
                  value={card.originalPrice ?? ""}
                  onChange={(event) =>
                    onChange({
                      ...block,
                      settings: {
                        ...block.settings,
                        cards: block.settings.cards.map((item) =>
                          item.id === card.id
                            ? {
                                ...item,
                                originalPrice: event.target.value
                                  ? Number(event.target.value)
                                  : undefined,
                              }
                            : item,
                        ),
                      },
                    })
                  }
                />
              </div>
              <textarea
                aria-label={`方案 ${index + 1} 特色`}
                className={panelTextarea}
                rows={3}
                value={card.features.join("\n")}
                onChange={(event) =>
                  onChange({
                    ...block,
                    settings: {
                      ...block.settings,
                      cards: block.settings.cards.map((item) =>
                        item.id === card.id
                          ? {
                              ...item,
                              features: event.target.value
                                .split("\n")
                                .map((value) => value.trim())
                                .filter(Boolean),
                            }
                          : item,
                      ),
                    },
                  })
                }
              />
            </fieldset>
          ))}
        </div>
        <button
          type="button"
          onClick={() =>
            onChange({
              ...block,
              settings: {
                ...block.settings,
                layout: "carousel",
                cards: [
                  ...block.settings.cards,
                  {
                    id: clientId("plan"),
                    name: `方案 ${block.settings.cards.length + 1}`,
                    salePrice: 0,
                    currency: "TWD",
                    features: ["方案特色"],
                    isFeatured: false,
                    badgeText: "熱門首選",
                    showBuyButton: true,
                    buyButtonLabel: "立即購買",
                    checkoutUrl: "#registration",
                    showMoreInfoButton: false,
                    moreInfoButtonLabel: "了解更多",
                  },
                ],
              },
            })
          }
          className="rounded-lg border border-blue-300 px-3 py-2 text-sm font-bold text-blue-700"
        >
          ＋ 新增方案
        </button>
      </div>
    );
  if (block.type === "carousel_slider")
    return (
      <div className="grid gap-4">
        <label className="grid gap-1 text-sm font-bold">
          自動播放
          <select
            className={panelInput}
            value={block.settings.autoPlay ? block.settings.intervalMs : 0}
            onChange={(event) => {
              const value = Number(event.target.value);
              onChange({
                ...block,
                settings: {
                  ...block.settings,
                  autoPlay: value !== 0,
                  intervalMs: (value || 5000) as 3000 | 5000 | 8000,
                },
              });
            }}
          >
            <option value={3000}>3 秒</option>
            <option value={5000}>5 秒</option>
            <option value={8000}>8 秒</option>
            <option value={0}>關閉</option>
          </select>
        </label>
        {block.settings.slides.map((slide, index) => (
          <fieldset key={slide.id} className="grid gap-2 rounded-xl border p-3">
            <legend className="text-sm font-bold">圖片 {index + 1}</legend>
            <input
              aria-label={`圖片 ${index + 1} URL`}
              className={panelInput}
              value={slide.imageUrl}
              onChange={(event) =>
                onChange({
                  ...block,
                  settings: {
                    ...block.settings,
                    slides: block.settings.slides.map((item) =>
                      item.id === slide.id
                        ? { ...item, imageUrl: event.target.value }
                        : item,
                    ),
                  },
                })
              }
            />
            <input
              aria-label={`圖片 ${index + 1} 標題`}
              className={panelInput}
              value={slide.title ?? ""}
              onChange={(event) =>
                onChange({
                  ...block,
                  settings: {
                    ...block.settings,
                    slides: block.settings.slides.map((item) =>
                      item.id === slide.id
                        ? { ...item, title: event.target.value }
                        : item,
                    ),
                  },
                })
              }
            />
            <button
              type="button"
              disabled={block.settings.slides.length === 1}
              onClick={() =>
                onChange({
                  ...block,
                  settings: {
                    ...block.settings,
                    slides: block.settings.slides.filter(
                      (item) => item.id !== slide.id,
                    ),
                  },
                })
              }
              className="text-left text-sm font-bold text-red-700 disabled:opacity-40"
            >
              刪除圖片
            </button>
          </fieldset>
        ))}
        <button
          type="button"
          onClick={() =>
            onChange({
              ...block,
              settings: {
                ...block.settings,
                slides: [
                  ...block.settings.slides,
                  {
                    id: clientId("slide"),
                    imageUrl:
                      "/images/funnel-templates/low-barrier-lead-magnet.svg",
                    imageAlt: "輪播圖片",
                    title: "新的輪播圖片",
                  },
                ],
              },
            })
          }
          className="rounded-lg border border-blue-300 px-3 py-2 text-sm font-bold text-blue-700"
        >
          ＋ 新增圖片
        </button>
      </div>
    );
  if (block.type === "countdown_timer")
    return (
      <fieldset className="grid gap-3">
        <legend className="mb-1 text-sm font-bold">計時模式</legend>
        {[
          ["fixed_date", "固定截止日期"],
          ["live_linked", "連動直播時間"],
          ["evergreen_minutes", "常青 15 分鐘"],
        ].map(([mode, label]) => (
          <label key={mode} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name={`countdown-${block.id}`}
              checked={block.settings.mode === mode}
              onChange={() =>
                onChange({
                  ...block,
                  settings: {
                    ...block.settings,
                    mode: mode as typeof block.settings.mode,
                    targetDate:
                      mode === "fixed_date"
                        ? (block.settings.targetDate ??
                          new Date(Date.now() + 86_400_000).toISOString())
                        : block.settings.targetDate,
                    scheduledAt:
                      mode === "live_linked"
                        ? (block.settings.scheduledAt ??
                          new Date(Date.now() + 86_400_000).toISOString())
                        : block.settings.scheduledAt,
                    evergreenMinutes:
                      mode === "evergreen_minutes"
                        ? 15
                        : block.settings.evergreenMinutes,
                  },
                })
              }
            />
            {label}
          </label>
        ))}
      </fieldset>
    );
  if (block.type === "lead_form")
    return (
      <label className="grid gap-1 text-sm font-bold">
        送出按鈕文案
        <input
          className={panelInput}
          maxLength={40}
          value={block.settings.submitLabel ?? ""}
          onChange={(event) =>
            onChange({
              ...block,
              settings: { ...block.settings, submitLabel: event.target.value },
            })
          }
        />
      </label>
    );
  return (
    <p className="text-sm leading-6 text-slate-600">
      此區塊目前可在畫布中排序、複製與刪除；內容沿用已驗證的範本設定。
    </p>
  );
}

export function FunnelCanvasEditor({
  formName,
  blocks,
  pending = false,
  onChange,
  onUseTraditionalEditor,
}: FunnelCanvasEditorProps) {
  const [device, setDevice] = useState<CanvasDevice>("desktop");
  const [selectedId, setSelectedId] = useState<string | null>(
    blocks[0]?.id ?? null,
  );
  const [insertAfter, setInsertAfter] = useState<number | null>(null);
  const [fullPreview, setFullPreview] = useState(false);
  const sorted = useMemo(() => ordered(blocks), [blocks]);
  const selected = sorted.find((block) => block.id === selectedId) ?? null;
  function replace(block: FunnelBlock) {
    onChange(
      ordered(sorted.map((item) => (item.id === block.id ? block : item))),
    );
  }
  function add(type: AddableBlockType) {
    const index = Math.max(
      0,
      Math.min(insertAfter ?? sorted.length, sorted.length),
    );
    const next = [...sorted];
    const block = defaultBlock(type, index);
    next.splice(index, 0, block);
    onChange(ordered(next));
    setSelectedId(block.id);
    setInsertAfter(null);
  }
  function duplicate(block: FunnelBlock) {
    const index = sorted.findIndex((item) => item.id === block.id);
    const copy = {
      ...structuredClone(block),
      id: clientId(block.type),
      sortOrder: index + 1,
    } as FunnelBlock;
    const next = [...sorted];
    next.splice(index + 1, 0, copy);
    onChange(ordered(next));
    setSelectedId(copy.id);
  }
  function remove(block: FunnelBlock) {
    if (!window.confirm(`確定刪除「${block.type}」區塊？`)) return;
    onChange(removeCanvasBlock(sorted, block.id));
    setSelectedId(null);
  }
  const canvas = (
    <div
      data-testid="canvas-shell"
      data-device={device}
      className={`mx-auto overflow-hidden bg-white shadow-2xl transition-[width] ${device === "mobile" ? "w-[390px] max-w-full" : "w-full max-w-[1280px]"}`}
    >
      {sorted.length === 0 ? (
        <div className="grid min-h-80 place-items-center p-8 text-center text-slate-500">
          畫布目前是空的，從下方加入第一個區塊。
        </div>
      ) : null}
      {sorted.map((block, index) => (
        <div key={block.id}>
          <button
            type="button"
            aria-label={`在第 ${index + 1} 個區塊前新增`}
            onClick={() => setInsertAfter(index)}
            className="group flex h-5 w-full items-center justify-center text-xs text-blue-600"
          >
            <span className="hidden rounded-full bg-blue-600 px-3 py-1 font-bold text-white group-hover:block group-focus:block">
              ＋ 新增區塊
            </span>
          </button>
          <section
            data-testid={`canvas-block-${block.id}`}
            onClick={() => setSelectedId(block.id)}
            className={`group relative cursor-pointer outline-offset-[-3px] ${selectedId === block.id ? "outline-3 outline-blue-500" : "hover:outline-2 hover:outline-blue-300"}`}
          >
            <div
              className={`absolute right-3 top-3 z-30 flex flex-wrap gap-1 rounded-xl bg-slate-950/95 p-1.5 text-xs font-bold text-white shadow-xl ${selectedId === block.id ? "flex" : "hidden group-hover:flex group-focus-within:flex"}`}
            >
              <button
                type="button"
                aria-label="上移"
                disabled={index === 0}
                onClick={(event) => {
                  event.stopPropagation();
                  onChange(moveCanvasBlock(sorted, block.id, -1));
                }}
                className="rounded px-2 py-1 disabled:opacity-30"
              >
                ↑ 上移
              </button>
              <button
                type="button"
                aria-label="下移"
                disabled={index === sorted.length - 1}
                onClick={(event) => {
                  event.stopPropagation();
                  onChange(moveCanvasBlock(sorted, block.id, 1));
                }}
                className="rounded px-2 py-1 disabled:opacity-30"
              >
                ↓ 下移
              </button>
              <button
                type="button"
                aria-label="複製區塊"
                onClick={(event) => {
                  event.stopPropagation();
                  duplicate(block);
                }}
                className="rounded px-2 py-1"
              >
                📋 複製
              </button>
              <button
                type="button"
                aria-label="刪除區塊"
                onClick={(event) => {
                  event.stopPropagation();
                  remove(block);
                }}
                className="rounded px-2 py-1 text-red-200"
              >
                🗑️ 刪除
              </button>
            </div>
            <BlockPreview block={block} />
          </section>
        </div>
      ))}
      <button
        type="button"
        onClick={() => setInsertAfter(sorted.length)}
        className="my-5 w-full rounded-xl border-2 border-dashed border-blue-300 py-3 text-sm font-bold text-blue-700"
      >
        ＋ 新增區塊
      </button>
    </div>
  );
  return (
    <section
      className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-100"
      aria-label="漏斗視覺化畫布編輯器"
    >
      <header className="sticky top-0 z-40 flex flex-wrap items-center justify-between gap-3 border-b bg-white/95 px-4 py-3 backdrop-blur">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-blue-600">
            Visual Funnel Studio
          </p>
          <h2 className="font-black text-slate-950">
            {formName || "未命名表單"}
          </h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <div
            role="group"
            aria-label="預覽裝置"
            className="flex rounded-lg border p-1"
          >
            <button
              type="button"
              aria-pressed={device === "mobile"}
              onClick={() => setDevice("mobile")}
              className={`rounded-md px-3 py-2 text-sm font-bold ${device === "mobile" ? "bg-slate-900 text-white" : "text-slate-600"}`}
            >
              📱 手機版
            </button>
            <button
              type="button"
              aria-pressed={device === "desktop"}
              onClick={() => setDevice("desktop")}
              className={`rounded-md px-3 py-2 text-sm font-bold ${device === "desktop" ? "bg-slate-900 text-white" : "text-slate-600"}`}
            >
              💻 桌面版
            </button>
          </div>
          <button
            type="button"
            onClick={() => setFullPreview(true)}
            className="rounded-lg border bg-white px-3 py-2 text-sm font-bold"
          >
            👁️ 全螢幕預覽
          </button>
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
          >
            💾 {pending ? "發布中…" : "儲存並發布"}
          </button>
        </div>
      </header>
      <div className="grid min-h-[680px] xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 overflow-x-auto p-4 sm:p-6">{canvas}</div>
        <aside className="border-l bg-white p-5" aria-label="區塊屬性面板">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Inspector
              </p>
              <h3 className="font-black text-slate-950">
                {selected ? "區塊屬性" : "尚未選取區塊"}
              </h3>
            </div>
            <button
              type="button"
              onClick={onUseTraditionalEditor}
              className="text-xs font-bold text-slate-500 underline"
            >
              傳統表單
            </button>
          </div>
          {selected ? (
            <Inspector block={selected} onChange={replace} />
          ) : (
            <p className="text-sm leading-6 text-slate-500">
              點選畫布中的區塊即可調整設定。
            </p>
          )}
        </aside>
      </div>
      {insertAfter !== null ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="新增區塊"
          className="fixed inset-0 z-50 grid place-items-center bg-slate-950/55 p-4"
          onClick={() => setInsertAfter(null)}
        >
          <div
            className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-black">新增區塊</h3>
              <button
                type="button"
                aria-label="關閉新增區塊"
                onClick={() => setInsertAfter(null)}
              >
                ✕
              </button>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              {[
                ["carousel_slider", "🖼️ 輪播圖"],
                ["pricing_table", "💳 價格卡"],
                ["countdown_timer", "⏳ 倒數計時"],
                ["lead_form", "📝 名單表單"],
                ["consultation_booking", "📅 預約諮詢"],
                ["accordion_faq", "❓ FAQ 折疊"],
              ].map(([type, label]) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => add(type as AddableBlockType)}
                  className="min-h-20 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm font-bold hover:border-blue-400 hover:bg-blue-50"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
      {fullPreview ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="全螢幕預覽"
          className="fixed inset-0 z-50 overflow-auto bg-slate-200 p-3"
        >
          <button
            type="button"
            onClick={() => setFullPreview(false)}
            className="fixed right-5 top-5 z-50 rounded-full bg-slate-950 px-4 py-2 font-bold text-white shadow-xl"
          >
            ✕ 關閉預覽
          </button>
          <div className="mx-auto min-h-screen max-w-[1440px] bg-white">
            {sorted.map((block) => (
              <BlockPreview key={block.id} block={block} />
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
