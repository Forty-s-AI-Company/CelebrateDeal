"use client";

import type { FieldProps, Config } from "@puckeditor/core";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import type { LandingPageAction, LandingPageFormReference, LandingPageRenderContext } from "@/lib/landing-page-content";

type ActionFieldProps = FieldProps & { forms: LandingPageFormReference[] };

function ActionField({ value, onChange, forms, label = "按鈕動作" }: ActionFieldProps & { label?: string }) {
  const action = value as LandingPageAction | undefined;
  const type = action?.type ?? "anchor";
  return <div className="grid gap-2">
    <label className="text-sm font-medium">{label}</label>
    <select value={type} onChange={(event) => {
      const nextType = event.currentTarget.value;
      onChange(nextType === "registration" ? { type: "registration", formId: forms[0]?.id ?? "" } : nextType === "external" ? { type: "external", href: "https://" } : { type: "anchor", targetId: "register" });
    }}>
      <option value="registration">開啟報名表單</option><option value="external">前往外部 HTTPS 網址</option><option value="anchor">捲動至頁面錨點</option>
    </select>
    {type === "registration" ? <select value={action?.type === "registration" ? action.formId : ""} onChange={(event) => onChange({ type: "registration", formId: event.currentTarget.value })}>
      <option value="">請選擇報名表單</option>{forms.map((form) => <option key={form.id} value={form.id}>{form.name}</option>)}
    </select> : null}
    {type === "external" ? <input aria-label="外部 HTTPS 網址" value={action?.type === "external" ? action.href : "https://"} onChange={(event) => onChange({ type: "external", href: event.currentTarget.value })} /> : null}
    {type === "anchor" ? <input aria-label="頁面錨點" value={action?.type === "anchor" ? action.targetId : "register"} onChange={(event) => onChange({ type: "anchor", targetId: event.currentTarget.value.replace(/^#/u, "") })} /> : null}
  </div>;
}

function StringListField({ value, onChange }: FieldProps) {
  const values = Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  return <label className="grid gap-1 text-sm font-medium">方案特色（每行一項）<textarea value={values.join("\n")} onChange={(event) => onChange(event.currentTarget.value.split("\n").map((item) => item.trim()).filter(Boolean))} /></label>;
}

const contentTypes = ["Heading", "Text", "Image", "Video", "Button", "Section", "Columns", "Hero", "Speaker", "Benefits", "Agenda", "Carousel", "Pricing", "Countdown", "Testimonials", "FAQ", "CTA"];
const slot = { type: "slot" as const, allow: contentTypes };
const textField = (label: string, multiline = false) => ({ type: multiline ? "textarea" as const : "text" as const, label });
const actionField = (forms: LandingPageFormReference[], label = "按鈕動作") => ({ type: "custom" as const, label: "動作設定", render: (props: FieldProps) => <ActionField {...props} forms={forms} label={label} /> });
const styleField = {
  type: "object" as const,
  label: "間距與行動版顯示",
  objectFields: {
    color: textField("文字顏色（#RRGGBB）"),
    backgroundColor: textField("背景顏色（#RRGGBB）"),
    padding: { type: "select" as const, label: "桌機內距", options: [{ label: "無", value: "none" }, { label: "小", value: "sm" }, { label: "中", value: "md" }, { label: "大", value: "lg" }, { label: "特大", value: "xl" }] },
    margin: { type: "select" as const, label: "外距", options: [{ label: "無", value: "none" }, { label: "小", value: "sm" }, { label: "中", value: "md" }, { label: "大", value: "lg" }, { label: "特大", value: "xl" }] },
    textAlign: { type: "select" as const, label: "文字對齊", options: [{ label: "靠左", value: "left" }, { label: "置中", value: "center" }, { label: "靠右", value: "right" }] },
    maxWidth: { type: "select" as const, label: "最大寬度", options: [{ label: "小", value: "sm" }, { label: "中", value: "md" }, { label: "大", value: "lg" }, { label: "特大", value: "xl" }, { label: "全寬", value: "full" }] },
    borderRadius: { type: "select" as const, label: "圓角", options: [{ label: "無", value: "none" }, { label: "小", value: "sm" }, { label: "中", value: "md" }, { label: "大", value: "lg" }, { label: "全圓", value: "full" }] },
    fontSize: { type: "select" as const, label: "字級", options: [{ label: "小", value: "sm" }, { label: "一般", value: "base" }, { label: "大", value: "lg" }, { label: "特大", value: "xl" }, { label: "2XL", value: "2xl" }, { label: "4XL", value: "4xl" }] },
    fontWeight: { type: "select" as const, label: "字重", options: [{ label: "一般", value: "normal" }, { label: "中等", value: "medium" }, { label: "粗體", value: "bold" }, { label: "特粗", value: "black" }] },
    mobile: { type: "object" as const, label: "手機版", objectFields: {
      hidden: { type: "radio" as const, label: "手機隱藏", options: [{ label: "顯示", value: false }, { label: "隱藏", value: true }] },
      padding: { type: "select" as const, label: "手機內距", options: [{ label: "不指定", value: "none" }, { label: "小", value: "sm" }, { label: "中", value: "md" }, { label: "大", value: "lg" }] },
      fontSize: { type: "select" as const, label: "手機字級", options: [{ label: "不指定", value: "base" }, { label: "小", value: "sm" }, { label: "中", value: "base" }, { label: "大", value: "lg" }, { label: "特大", value: "xl" }] },
    } },
  },
};

function editorStyle(style: unknown): CSSProperties | undefined {
  if (!style || typeof style !== "object") return undefined;
  const value = style as { color?: string; backgroundColor?: string; textAlign?: CSSProperties["textAlign"] };
  return { color: value.color, backgroundColor: value.backgroundColor, textAlign: value.textAlign };
}

type SlotProps = (props?: { minEmptyHeight?: number }) => ReactNode;

/** Puck config is client-only; public pages use LandingPageRenderer and never import this module. */
export function createLandingPagePuckConfig(context: Pick<LandingPageRenderContext, "forms">): Config {
  const action = actionField(context.forms);
  const config: Config = {
    categories: {
      basic: { title: "Elements · 基本內容", components: ["Heading", "Text", "Image", "Video", "Button"] },
      layout: { title: "Elements · 版面配置", components: ["Section", "Columns"] },
      conversion: { title: "Blocks · Webinar 轉換", components: ["Hero", "Speaker", "Benefits", "Agenda", "Carousel", "Pricing", "Countdown", "Testimonials", "FAQ", "CTA"] },
    },
    root: { fields: { title: textField("頁面標題"), description: textField("SEO 描述", true), shareImage: textField("分享圖片 HTTPS 網址") }, render: ({ children }: { children: ReactNode }) => <main className="mx-auto min-h-screen w-full max-w-6xl bg-white px-4 py-8 text-slate-950 sm:px-6">{children}</main> },
    components: {
      Heading: { label: "標題", fields: { text: textField("內容"), level: { type: "select", label: "層級", options: [{ label: "主標題", value: "h1" }, { label: "次標題", value: "h2" }, { label: "小標", value: "h3" }] } }, defaultProps: { text: "新的標題", level: "h2" }, render: ({ text, level }) => level === "h1" ? <h1 className="text-4xl font-black">{text}</h1> : level === "h3" ? <h3 className="text-xl font-bold">{text}</h3> : <h2 className="text-3xl font-black">{text}</h2> },
      Text: { label: "內文", fields: { text: textField("內容", true) }, defaultProps: { text: "在這裡寫下你想說的內容。" }, render: ({ text }) => <p className="whitespace-pre-line leading-7 text-slate-700">{text}</p> },
      Image: { label: "圖片", fields: { src: textField("圖片網址"), alt: textField("替代文字"), caption: textField("說明", true) }, defaultProps: { src: "/images/funnel-templates/low-barrier-lead-magnet.svg", alt: "" }, render: ({ src, alt, caption }) => <figure><img src={src} alt={alt} className="h-auto w-full rounded-2xl object-cover" />{caption ? <figcaption className="mt-2 text-sm text-slate-500">{caption}</figcaption> : null}</figure> },
      Video: { label: "影片", fields: { src: textField("影片網址"), title: textField("影片標題") }, defaultProps: { src: "https://example.com/video.mp4", title: "影片標題" }, render: ({ src, title }) => <video className="w-full rounded-2xl" controls src={src} title={title}>你的瀏覽器不支援影片播放。</video> },
      Button: { label: "按鈕", fields: { label: textField("按鈕文字"), action }, defaultProps: { label: "立即行動", action: { type: "anchor", targetId: "register" } }, render: ({ label }) => <button type="button" className="rounded-xl bg-blue-700 px-5 py-3 font-bold text-white shadow-sm transition hover:bg-blue-800">{label}</button> },
      Section: { label: "區段（可巢狀拖放）", fields: { anchorId: textField("錨點 ID"), style: styleField, children: slot }, defaultProps: { children: [] }, render: ({ children }) => { const Children = children as SlotProps; return <section className="mx-auto my-5 max-w-6xl rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)] md:p-8"><Children minEmptyHeight={96} /></section>; } },
      Columns: { label: "欄位（1／2／3 欄，可拖放）", fields: { columns: { type: "select", label: "欄數", options: [{ label: "一欄", value: "one" }, { label: "兩欄", value: "two" }, { label: "三欄", value: "three" }] }, ratio: { type: "select", label: "兩欄比例", options: [{ label: "等寬", value: "equal" }, { label: "第一欄較寬", value: "wideFirst" }, { label: "最後欄較寬", value: "wideLast" }] }, style: styleField, first: slot, second: slot, third: slot }, defaultProps: { columns: "two", ratio: "equal", first: [], second: [], third: [] }, render: ({ first, second, third, columns, ratio }) => { const First = first as SlotProps; const Second = second as SlotProps; const Third = third as SlotProps; const className = columns === "one" ? "grid gap-5" : columns === "three" ? "grid gap-5 md:grid-cols-3" : ratio === "wideFirst" ? "grid gap-5 md:grid-cols-[1.5fr_1fr]" : ratio === "wideLast" ? "grid gap-5 md:grid-cols-[1fr_1.5fr]" : "grid gap-5 md:grid-cols-2"; return <section className={className}><div className="min-h-24 rounded-2xl border border-dashed border-slate-300 p-4"><First minEmptyHeight={96} /></div>{columns !== "one" ? <div className="min-h-24 rounded-2xl border border-dashed border-slate-300 p-4"><Second minEmptyHeight={96} /></div> : null}{columns === "three" ? <div className="min-h-24 rounded-2xl border border-dashed border-slate-300 p-4"><Third minEmptyHeight={96} /></div> : null}</section>; } },
      Hero: { label: "主視覺", fields: { eyebrow: textField("眉標"), title: textField("標題"), description: textField("說明", true), imageUrl: textField("背景圖片網址"), ctaLabel: textField("按鈕文字"), ctaAction: action }, defaultProps: { title: "讓你的活動被看見", description: "用清楚的內容，邀請對的人加入。", ctaLabel: "立即報名", ctaAction: { type: "anchor", targetId: "register" } }, render: ({ eyebrow, title, description, ctaLabel }) => <section className="rounded-3xl bg-gradient-to-br from-blue-950 via-blue-900 to-blue-700 px-7 py-16 text-white shadow-lg md:px-12">{eyebrow ? <p className="text-sm font-bold tracking-widest text-blue-200">{eyebrow}</p> : null}<h1 className="mt-3 text-4xl font-black tracking-tight">{title}</h1>{description ? <p className="mt-4 max-w-2xl whitespace-pre-line text-blue-100">{description}</p> : null}{ctaLabel ? <button type="button" className="mt-7 rounded-xl bg-white px-5 py-3 font-bold text-blue-950 shadow-sm">{ctaLabel}</button> : null}</section> },
      Speaker: { label: "講者", fields: { name: textField("姓名"), role: textField("職稱"), bio: textField("介紹", true), imageUrl: textField("照片網址") }, defaultProps: { name: "講者姓名", role: "專業職稱" }, render: ({ name, role, bio, imageUrl }) => <section className="flex gap-5 rounded-2xl bg-slate-50 p-6">{imageUrl ? <img src={imageUrl} alt="" className="h-20 w-20 rounded-full object-cover" /> : null}<div><h2 className="text-2xl font-black">{name}</h2>{role ? <p className="mt-1 font-medium text-slate-600">{role}</p> : null}{bio ? <p className="mt-3 whitespace-pre-line text-slate-700">{bio}</p> : null}</div></section> },
      Benefits: { label: "亮點", fields: { title: textField("標題"), items: { type: "array", label: "亮點項目", min: 1, max: 12, arrayFields: { title: textField("標題"), description: textField("說明", true) }, defaultItemProps: { title: "新的亮點" } } }, defaultProps: { title: "你會獲得", items: [{ title: "第一個亮點" }] }, render: ({ title, items }) => <section><h2 className="text-3xl font-black">{title}</h2><div className="mt-5 grid gap-4 md:grid-cols-2">{items.map((item: { title: string; description?: string }, index: number) => <article key={index} className="rounded-2xl border p-5"><h3 className="font-bold">{item.title}</h3>{item.description ? <p className="mt-2 text-slate-600">{item.description}</p> : null}</article>)}</div></section> },
      Agenda: { label: "議程", fields: { title: textField("標題"), items: { type: "array", label: "議程項目", min: 1, max: 20, arrayFields: { time: textField("時間"), title: textField("標題"), description: textField("說明", true) }, defaultItemProps: { title: "新的議程" } } }, defaultProps: { title: "活動議程", items: [{ title: "開場" }] }, render: ({ title, items }) => <section><h2 className="text-3xl font-black">{title}</h2>{items.map((item: { time?: string; title: string; description?: string }, index: number) => <div key={index} className="mt-4 border-l-2 border-blue-500 pl-4"><p className="text-sm font-bold text-blue-700">{item.time}</p><h3 className="font-bold">{item.title}</h3><p className="text-slate-600">{item.description}</p></div>)}</section> },
      Carousel: { label: "圖片輪播", fields: { title: textField("標題"), slides: { type: "array", label: "投影片", min: 1, max: 12, arrayFields: { imageUrl: textField("圖片網址"), alt: textField("替代文字"), title: textField("標題"), description: textField("說明", true) }, defaultItemProps: { imageUrl: "/images/funnel-templates/low-barrier-lead-magnet.svg", alt: "" } } }, defaultProps: { title: "精彩內容", slides: [{ imageUrl: "/images/funnel-templates/low-barrier-lead-magnet.svg", alt: "" }] }, render: ({ title, slides }) => <section><h2 className="text-3xl font-black">{title}</h2><div className="mt-5 grid gap-4 md:grid-cols-3">{slides.map((slide: { imageUrl: string; alt: string; title?: string }, index: number) => <figure key={index}><img src={slide.imageUrl} alt={slide.alt} className="aspect-video w-full rounded-2xl object-cover" />{slide.title ? <figcaption className="mt-2 font-bold">{slide.title}</figcaption> : null}</figure>)}</div></section> },
      Pricing: { label: "方案價格", fields: { title: textField("標題"), plans: { type: "array", label: "方案", min: 1, max: 6, arrayFields: { name: textField("方案名稱"), price: textField("價格"), description: textField("說明", true), label: textField("標籤"), features: { type: "custom", label: "方案特色", render: (props: FieldProps) => <StringListField {...props} /> }, action }, defaultItemProps: { name: "方案", price: "NT$ 0", features: [] } } }, defaultProps: { title: "選擇適合你的方案", plans: [{ name: "標準方案", price: "NT$ 0", features: [] }] }, render: ({ title, plans }) => <section><h2 className="text-3xl font-black">{title}</h2><div className="mt-5 grid gap-4 md:grid-cols-3">{plans.map((plan: { name: string; price: string; description?: string }, index: number) => <article key={index} className="rounded-2xl border p-6"><h3 className="font-bold">{plan.name}</h3><p className="mt-2 text-3xl font-black">{plan.price}</p><p className="mt-3 text-slate-600">{plan.description}</p></article>)}</div></section> },
      Countdown: { label: "倒數計時＋報名 CTA", fields: { title: textField("標題"), mode: { type: "select", label: "倒數模式", options: [{ label: "固定截止時間", value: "fixed_date" }, { label: "依直播開播時間", value: "live_linked" }] }, targetAt: textField("固定截止時間（ISO 8601，包含時區）"), ctaLabel: textField("倒數下方按鈕文字"), ctaAction: action, expiredMessage: textField("結束訊息"), expiredAction: { type: "select", label: "倒數結束後", options: [{ label: "顯示結束訊息", value: "show_message" }, { label: "隱藏報名按鈕", value: "hide_cta" }, { label: "轉址到指定頁面", value: "redirect" }] }, expiredRedirect: actionField(context.forms, "到期後前往") }, defaultProps: { title: "報名即將截止", mode: "fixed_date", targetAt: "2030-01-01T00:00:00+08:00", ctaLabel: "立即保留席次", ctaAction: { type: "anchor", targetId: "register" }, expiredMessage: "本次報名已截止", expiredAction: "show_message" }, render: ({ title, mode, targetAt, ctaLabel }) => <section className="rounded-2xl border border-amber-200 bg-gradient-to-b from-amber-50 to-orange-50 p-6 text-center"><h2 className="text-2xl font-black">{title}</h2><time className="mt-3 block font-bold tabular-nums text-amber-900">{mode === "live_linked" ? "依直播開播時間倒數" : `截止：${targetAt}`}</time>{ctaLabel ? <button type="button" className="mt-5 rounded-xl bg-amber-500 px-5 py-3 font-bold text-slate-950 shadow-sm">{ctaLabel}</button> : null}</section> },
      Testimonials: { label: "見證", fields: { title: textField("標題"), items: { type: "array", label: "見證內容", min: 1, max: 12, arrayFields: { quote: textField("心得", true), name: textField("姓名"), role: textField("身分") }, defaultItemProps: { quote: "這是一段心得。", name: "參與者" } } }, defaultProps: { title: "參與者怎麼說", items: [{ quote: "這是一段心得。", name: "參與者" }] }, render: ({ title, items }) => <section><h2 className="text-3xl font-black">{title}</h2>{items.map((item: { quote: string; name: string; role?: string }, index: number) => <blockquote key={index} className="mt-4 rounded-2xl bg-slate-50 p-5">「{item.quote}」<footer className="mt-3 font-bold">{item.name}{item.role ? `｜${item.role}` : ""}</footer></blockquote>)}</section> },
      FAQ: { label: "常見問題", fields: { title: textField("標題"), items: { type: "array", label: "問題", min: 1, max: 24, arrayFields: { question: textField("問題"), answer: textField("答案", true) }, defaultItemProps: { question: "常見問題", answer: "在這裡回答問題。" } } }, defaultProps: { title: "常見問題", items: [{ question: "常見問題", answer: "在這裡回答問題。" }] }, render: ({ title, items }) => <section><h2 className="text-3xl font-black">{title}</h2>{items.map((item: { question: string; answer: string }, index: number) => <details key={index} className="mt-3 rounded-xl border p-4"><summary className="cursor-pointer font-bold">{item.question}</summary><p className="mt-3 whitespace-pre-line text-slate-600">{item.answer}</p></details>)}</section> },
      CTA: { label: "行動呼籲", fields: { title: textField("標題"), description: textField("說明", true), ctaLabel: textField("按鈕文字"), ctaAction: action }, defaultProps: { title: "準備好了嗎？", ctaLabel: "立即報名", ctaAction: { type: "anchor", targetId: "register" } }, render: ({ title, description, ctaLabel }) => <section className="rounded-3xl bg-blue-600 p-8 text-center text-white shadow-lg"><h2 className="text-3xl font-black">{title}</h2>{description ? <p className="mt-3 text-blue-100">{description}</p> : null}{ctaLabel ? <button type="button" className="mt-5 rounded-xl bg-white px-5 py-3 font-bold text-blue-900">{ctaLabel}</button> : null}</section> },
    },
  };
  for (const component of Object.values(config.components) as Array<{ fields?: Record<string, unknown>; render: (props: Record<string, unknown>) => ReactElement }>) {
    component.fields = { ...component.fields, style: component.fields?.style ?? styleField };
    const render = component.render;
    component.render = (props) => <div className="landing-page-editor-block mb-12" style={editorStyle(props.style)}>{render(props)}</div>;
  }
  return config;
}
