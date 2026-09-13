/* eslint-disable @next/next/no-img-element */
import { LandingPageLink } from "@/components/landing-page-link";
import { LandingPageCarousel, LandingPageCountdown } from "./landing-page-interactive-blocks";
import type { LandingPageAction, LandingPageContent, LandingPagePuckData, LandingPageRenderContext } from "@/lib/landing-page-content";

const spacing = { none: "", sm: "p-3", md: "p-5", lg: "p-8", xl: "p-12" } as const;
const width = { sm: "max-w-xl", md: "max-w-3xl", lg: "max-w-5xl", xl: "max-w-6xl", full: "max-w-none" } as const;
const align = { left: "text-left", center: "text-center", right: "text-right" } as const;
const radius = { none: "", sm: "rounded", md: "rounded-xl", lg: "rounded-2xl", full: "rounded-full" } as const;
const fontSize = { sm: "text-sm", base: "text-base", lg: "text-lg", xl: "text-xl", "2xl": "text-2xl", "4xl": "text-4xl" } as const;
const fontWeight = { normal: "font-normal", medium: "font-medium", bold: "font-bold", black: "font-black" } as const;

type Block = LandingPagePuckData["content"][number];

function classes(style: Block["props"]["style"]) {
  if (!style) return "";
  const mobile = style.mobile;
  const mobilePadding = mobile?.padding === "sm" ? "max-md:p-3" : mobile?.padding === "md" ? "max-md:p-5" : mobile?.padding === "lg" ? "max-md:p-8" : "";
  const mobileFontSize = mobile?.fontSize === "sm" ? "max-md:text-sm" : mobile?.fontSize === "base" ? "max-md:text-base" : mobile?.fontSize === "lg" ? "max-md:text-lg" : mobile?.fontSize === "xl" ? "max-md:text-xl" : mobile?.fontSize === "2xl" ? "max-md:text-2xl" : "";
  return [style.padding ? spacing[style.padding] : "", style.margin === "sm" ? "m-3" : style.margin === "md" ? "m-5" : style.margin === "lg" ? "m-8" : style.margin === "xl" ? "m-12" : "", style.maxWidth ? width[style.maxWidth] : "", style.textAlign ? align[style.textAlign] : "", style.borderRadius ? radius[style.borderRadius] : "", style.fontSize ? fontSize[style.fontSize] : "", style.fontWeight ? fontWeight[style.fontWeight] : "", mobile?.hidden ? "max-md:hidden" : "", mobilePadding, mobileFontSize].filter(Boolean).join(" ");
}

function styleValues(style: Block["props"]["style"]) {
  return style ? { backgroundColor: style.backgroundColor, color: style.color } : undefined;
}

function actionHref(action: LandingPageAction, context: LandingPageRenderContext) {
  if (action.type === "external") return action.href;
  if (action.type === "anchor") return `#${action.targetId}`;
  const form = context.forms.find((item) => item.id === action.formId);
  if (!form) return "#";
  const liveId = context.live?.formId === action.formId ? context.live.id : undefined;
  return `/form/${encodeURIComponent(form.slug)}${liveId ? `?liveId=${encodeURIComponent(liveId)}` : ""}`;
}

function ActionButton({ label, action, context, inverse = false }: { label: string; action?: LandingPageAction; context: LandingPageRenderContext; inverse?: boolean }) {
  if (!action) return null;
  return <LandingPageLink href={actionHref(action, context)} pageId={context.pageId} className={`inline-flex w-fit items-center justify-center rounded-xl px-5 py-3 font-bold shadow-sm transition focus-visible:outline-2 focus-visible:outline-offset-4 ${inverse ? "bg-white text-blue-900 hover:bg-blue-50" : "bg-blue-700 text-white hover:bg-blue-800"}`}>{label}</LandingPageLink>;
}

function NestedBlocks({ blocks, context }: { blocks: Block[]; context: LandingPageRenderContext }) {
  return <>{blocks.map((block) => <LandingPageBlock key={block.props.id} block={block} context={context} />)}</>;
}

function Heading({ block }: { block: Extract<Block, { type: "Heading" }> }) {
  const Tag = block.props.level;
  return <Tag className={`${classes(block.props.style)} mx-auto tracking-tight`} style={styleValues(block.props.style)}>{block.props.text}</Tag>;
}

function safeEmbedUrl(src: string) {
  try {
    const url = new URL(src);
    const host = url.hostname.toLowerCase();
    const youtubeHosts = new Set(["youtube.com", "www.youtube.com", "m.youtube.com"]);
    const shortHosts = new Set(["youtu.be", "www.youtu.be"]);
    if (youtubeHosts.has(host)) {
      const id = url.pathname === "/watch" ? url.searchParams.get("v") : url.pathname.match(/^\/embed\/([A-Za-z0-9_-]{6,})$/u)?.[1];
      return id && /^[A-Za-z0-9_-]{6,}$/u.test(id) ? `https://www.youtube-nocookie.com/embed/${id}` : null;
    }
    if (shortHosts.has(host)) {
      const id = url.pathname.match(/^\/([A-Za-z0-9_-]{6,})$/u)?.[1];
      return id ? `https://www.youtube-nocookie.com/embed/${id}` : null;
    }
    if (host === "vimeo.com" || host === "www.vimeo.com" || host === "player.vimeo.com") {
      const id = url.pathname.match(/^(?:\/video)?\/([0-9]{6,})$/u)?.[1];
      return id ? `https://player.vimeo.com/video/${id}` : null;
    }
  } catch { /* Validated content still treats unembeddable URLs as a normal video source. */ }
  return null;
}

function Video({ src, title }: { src: string; title: string }) {
  const embedUrl = safeEmbedUrl(src);
  return embedUrl ? <iframe className="aspect-video w-full rounded-2xl" src={embedUrl} title={title} sandbox="allow-scripts allow-same-origin allow-presentation" allowFullScreen /> : <video className="w-full rounded-2xl" controls preload="metadata" src={src} title={title}>你的瀏覽器不支援影片播放。</video>;
}

function Carousel({ block }: { block: Extract<Block, { type: "Carousel" }> }) {
  return <section className={`${classes(block.props.style)} mx-auto`} style={styleValues(block.props.style)}>{block.props.title ? <h2 className="text-3xl font-black">{block.props.title}</h2> : null}<LandingPageCarousel slides={block.props.slides} /></section>;
}

function Pricing({ block, context }: { block: Extract<Block, { type: "Pricing" }>; context: LandingPageRenderContext }) {
  return <section className={`${classes(block.props.style)} mx-auto`} style={styleValues(block.props.style)}>{block.props.title ? <h2 className="text-3xl font-black">{block.props.title}</h2> : null}<div className="mt-5 grid gap-4 md:grid-cols-3">{block.props.plans.map((plan, index) => <article key={`${plan.name}-${index}`} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">{plan.label ? <p className="text-sm font-bold text-amber-700">{plan.label}</p> : null}<h3 className="mt-1 text-xl font-black">{plan.name}</h3><p className="mt-3 text-3xl font-black">{plan.price}</p>{plan.description ? <p className="mt-3 text-slate-600">{plan.description}</p> : null}{plan.features.length ? <ul className="mt-4 grid gap-2 text-sm text-slate-700">{plan.features.map((feature) => <li key={feature}>✓ {feature}</li>)}</ul> : null}{plan.action ? <div className="mt-5"><ActionButton label="選擇此方案" action={plan.action} context={context} /></div> : null}</article>)}</div></section>;
}

function RenderHero({ block, context }: { block: Extract<Block, { type: "Hero" }>; context: LandingPageRenderContext }) {
  return <section className={`${classes(block.props.style)} relative isolate mx-auto overflow-hidden rounded-3xl bg-gradient-to-br from-blue-950 via-blue-900 to-blue-700 px-7 py-16 text-white shadow-lg md:px-12`} style={styleValues(block.props.style)}>{block.props.imageUrl ? <img src={block.props.imageUrl} alt="" className="absolute inset-0 -z-20 h-full w-full object-cover opacity-35" /> : null}<div className="max-w-3xl">{block.props.eyebrow ? <p className="text-sm font-black tracking-[0.2em] text-blue-200">{block.props.eyebrow}</p> : null}<h1 className="mt-3 text-4xl font-black tracking-tight sm:text-6xl">{block.props.title}</h1>{block.props.description ? <p className="mt-5 whitespace-pre-line text-lg leading-8 text-blue-100">{block.props.description}</p> : null}{block.props.ctaLabel ? <div className="mt-8"><ActionButton label={block.props.ctaLabel} action={block.props.ctaAction} context={context} inverse /></div> : null}</div></section>;
}

function RenderTestimonials({ block }: { block: Extract<Block, { type: "Testimonials" }> }) {
  return <section className={`${classes(block.props.style)} mx-auto`} style={styleValues(block.props.style)}>{block.props.title ? <h2 className="text-3xl font-black">{block.props.title}</h2> : null}<div className="mt-5 grid gap-4 md:grid-cols-2">{block.props.items.map((item, index) => <blockquote key={`${item.name}-${index}`} className="rounded-2xl bg-slate-50 p-5">「{item.quote}」<footer className="mt-3 flex items-center gap-2 font-bold">{item.imageUrl ? <img src={item.imageUrl} alt="" className="h-8 w-8 rounded-full object-cover" /> : null}{item.name}{item.role ? `｜${item.role}` : ""}</footer></blockquote>)}</div></section>;
}

function RenderCTA({ block, context }: { block: Extract<Block, { type: "CTA" }>; context: LandingPageRenderContext }) {
  return <section className={`${classes(block.props.style)} mx-auto rounded-3xl bg-blue-600 p-8 text-center text-white shadow-lg`} style={styleValues(block.props.style)}><h2 className="text-3xl font-black">{block.props.title}</h2>{block.props.description ? <p className="mt-3 whitespace-pre-line text-blue-100">{block.props.description}</p> : null}{block.props.ctaLabel ? <div className="mt-5"><ActionButton label={block.props.ctaLabel} action={block.props.ctaAction} context={context} inverse /></div> : null}</section>;
}

function RenderSpeaker({ block }: { block: Extract<Block, { type: "Speaker" }> }) {
  return <section className={`${classes(block.props.style)} mx-auto flex gap-5`} style={styleValues(block.props.style)}>{block.props.imageUrl ? <img src={block.props.imageUrl} alt={`${block.props.name}照片`} className="h-20 w-20 rounded-full object-cover" /> : null}<div><h2 className="text-2xl font-black">{block.props.name}</h2>{block.props.role ? <p className="mt-1 font-medium text-slate-600">{block.props.role}</p> : null}{block.props.bio ? <p className="mt-3 whitespace-pre-line leading-7 text-slate-700">{block.props.bio}</p> : null}</div></section>;
}

function RenderColumns({ block, context }: { block: Extract<Block, { type: "Columns" }>; context: LandingPageRenderContext }) {
  return <section className={`${classes(block.props.style)} mx-auto grid gap-6 ${block.props.columns === "one" ? "grid-cols-1" : block.props.columns === "three" ? "md:grid-cols-3" : block.props.ratio === "wideFirst" ? "md:grid-cols-[1.5fr_1fr]" : block.props.ratio === "wideLast" ? "md:grid-cols-[1fr_1.5fr]" : "md:grid-cols-2"}`} style={styleValues(block.props.style)}><NestedBlocks blocks={block.props.first as Block[]} context={context} />{block.props.columns !== "one" ? <NestedBlocks blocks={block.props.second as Block[]} context={context} /> : null}{block.props.columns === "three" ? <NestedBlocks blocks={block.props.third as Block[]} context={context} /> : null}</section>;
}

function LandingPageBlock({ block, context }: { block: Block; context: LandingPageRenderContext }) {
  switch (block.type) {
    case "Heading": return <Heading block={block} />;
    case "Text": return <p className={`${classes(block.props.style)} mx-auto whitespace-pre-line leading-7`} style={styleValues(block.props.style)}>{block.props.text}</p>;
    case "Image": return <figure className={`${classes(block.props.style)} mx-auto`} style={styleValues(block.props.style)}><img src={block.props.src} alt={block.props.alt} className="h-auto w-full object-cover" />{block.props.caption ? <figcaption className="mt-2 text-sm text-slate-500">{block.props.caption}</figcaption> : null}</figure>;
    case "Video": return <div className={`${classes(block.props.style)} mx-auto`} style={styleValues(block.props.style)}><Video src={block.props.src} title={block.props.title} /></div>;
    case "Button": return <div className={`${classes(block.props.style)} mx-auto`} style={styleValues(block.props.style)}><ActionButton label={block.props.label} action={block.props.action} context={context} /></div>;
    case "Section": return <section id={block.props.anchorId} className={`${classes(block.props.style)} mx-auto`} style={styleValues(block.props.style)}><NestedBlocks blocks={block.props.children as Block[]} context={context} /></section>;
    case "Columns": return <RenderColumns block={block} context={context} />;
    case "Hero": return <RenderHero block={block} context={context} />;
    case "Speaker": return <RenderSpeaker block={block} />;
    case "Benefits": return <section className={`${classes(block.props.style)} mx-auto`} style={styleValues(block.props.style)}>{block.props.title ? <h2 className="text-3xl font-black">{block.props.title}</h2> : null}<div className="mt-5 grid gap-4 md:grid-cols-2">{block.props.items.map((item, index) => <article key={`${item.title}-${index}`} className="rounded-2xl border border-slate-200 p-5"><h3 className="font-bold">{item.title}</h3>{item.description ? <p className="mt-2 text-slate-600">{item.description}</p> : null}</article>)}</div></section>;
    case "Agenda": return <section className={`${classes(block.props.style)} mx-auto`} style={styleValues(block.props.style)}>{block.props.title ? <h2 className="text-3xl font-black">{block.props.title}</h2> : null}{block.props.items.map((item, index) => <div key={`${item.title}-${index}`} className="mt-4 border-l-2 border-blue-500 pl-4">{item.time ? <p className="text-sm font-bold text-blue-700">{item.time}</p> : null}<h3 className="font-bold">{item.title}</h3>{item.description ? <p className="text-slate-600">{item.description}</p> : null}</div>)}</section>;
    case "Carousel": return <Carousel block={block} />;
    case "Pricing": return <Pricing block={block} context={context} />;
    case "Countdown": return <section className={`${classes(block.props.style)} mx-auto rounded-2xl border border-blue-100 bg-blue-50 p-6 text-center`} style={styleValues(block.props.style)}>{block.props.title ? <h2 className="text-2xl font-black">{block.props.title}</h2> : null}<LandingPageCountdown targetAt={block.props.mode === "live_linked" ? context.live?.scheduledAt : block.props.targetAt} expiredMessage={block.props.expiredMessage} /></section>;
    case "Testimonials": return <RenderTestimonials block={block} />;
    case "FAQ": return <section className={`${classes(block.props.style)} mx-auto`} style={styleValues(block.props.style)}>{block.props.title ? <h2 className="text-3xl font-black">{block.props.title}</h2> : null}{block.props.items.map((item, index) => <details key={`${item.question}-${index}`} className="mt-3 rounded-xl border border-slate-200 p-4"><summary className="cursor-pointer font-bold">{item.question}</summary><p className="mt-3 whitespace-pre-line leading-7 text-slate-600">{item.answer}</p></details>)}</section>;
    case "CTA": return <RenderCTA block={block} context={context} />;
  }
}

/** Server-safe public renderer. It has no dependency on Puck's editor or drag-and-drop runtime. */
export function LandingPageRenderer({ content, context }: { content: LandingPageContent; context: LandingPageRenderContext }) {
  const rootStyle = content.data.root.props?.style;
  return <main className={`mx-auto min-h-screen w-full max-w-6xl space-y-12 bg-white px-4 py-8 text-slate-950 sm:px-6 md:space-y-16 ${classes(rootStyle)}`} style={styleValues(rootStyle)}><NestedBlocks blocks={content.data.content} context={context} /></main>;
}
