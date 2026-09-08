import Image from "next/image";
import { CarouselBlock } from "@/components/funnel-blocks/carousel-block";
import { CountdownTimerBlock } from "@/components/funnel-blocks/countdown-timer-block";
import { LeadFormBlock } from "@/components/funnel-blocks/lead-form-block";
import { PricingTableBlock } from "@/components/funnel-blocks/pricing-table-block";
import { ConsultationBookingBlock } from "@/components/funnel-blocks/consultation-booking-block";
import type { FunnelPageBlocks } from "@/lib/funnel-blocks-schema";
import type { PublicRegistrationForm } from "@/lib/public-registration-form";

export function FunnelPageRenderer({ blocks, form, themeColor, consultationBooking }: { blocks: FunnelPageBlocks; form: PublicRegistrationForm; themeColor: string; consultationBooking?: { eventId: string; csrfToken: string } }) {
  const visibleBlocks = [...blocks].filter((block) => block.isVisible).sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id));
  if (visibleBlocks.length === 0) return <div role="alert" className="mx-auto my-10 max-w-2xl rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">這個頁面的區塊設定尚未完成，目前暫停顯示。</div>;
  return <main className="min-h-screen bg-slate-50" style={{ "--funnel-theme": themeColor } as React.CSSProperties}>{visibleBlocks.map((block) => {
    if (block.type === "carousel_slider") return <CarouselBlock key={block.id} settings={block.settings} />;
    if (block.type === "pricing_table") return <PricingTableBlock key={block.id} settings={block.settings} />;
    if (block.type === "countdown_timer") {
      const linkedSession = form.sessions.find((session) => session.status === "live") ?? form.sessions[0];
      const settings = block.settings.mode === "live_linked" && linkedSession ? { ...block.settings, scheduledAt: linkedSession.scheduledAt, liveStatus: linkedSession.status } : block.settings;
      return <CountdownTimerBlock key={block.id} blockId={block.id} settings={settings} />;
    }
    if (block.type === "lead_form") return <LeadFormBlock key={block.id} settings={block.settings} form={form} themeColor={themeColor} />;
    if (block.type === "consultation_booking") {
      const event = form.consultationEvent;
      const settings = event ? { ...block.settings, title: event.title, durationMinutes: event.durationMinutes, timezone: event.timezone, intakeFields: Array.isArray(event.intakeFormFields) ? event.intakeFormFields as typeof block.settings.intakeFields : block.settings.intakeFields } : block.settings;
      return <ConsultationBookingBlock key={block.id} settings={settings} {...consultationBooking} />;
    }
    if (block.type === "hero_banner") return <section key={block.id} className="relative isolate overflow-hidden bg-slate-950 text-white">{block.settings.imageUrl ? <Image src={block.settings.imageUrl} alt={block.settings.imageAlt} fill unoptimized loading="lazy" sizes="100vw" className="-z-20 object-cover" /> : null}<div className="absolute inset-0 -z-10 bg-slate-950/65" /><div className="mx-auto grid min-h-[480px] max-w-6xl content-center px-5 py-20 sm:px-8">{block.settings.eyebrow ? <p className="mb-3 text-sm font-black uppercase tracking-[0.2em] text-orange-300">{block.settings.eyebrow}</p> : null}<h1 className="max-w-4xl text-4xl font-black tracking-tight sm:text-6xl">{block.settings.headline}</h1>{block.settings.description ? <p className="mt-5 max-w-2xl whitespace-pre-line text-lg leading-8 text-slate-200">{block.settings.description}</p> : null}{block.settings.ctaLabel && block.settings.ctaHref ? <a href={block.settings.ctaHref} className="mt-8 w-fit rounded-xl bg-[var(--funnel-theme)] px-6 py-3 font-black text-white">{block.settings.ctaLabel}</a> : null}</div></section>;
    return <section key={block.id} className="mx-auto max-w-4xl px-4 py-12 sm:px-6">{block.settings.title ? <h2 className="mb-6 text-3xl font-black text-slate-950">{block.settings.title}</h2> : null}<div className="grid gap-3">{block.settings.items.map((item) => <details key={item.id} className="rounded-2xl border border-slate-200 bg-white p-5"><summary className="cursor-pointer font-bold text-slate-950">{item.question}</summary><p className="mt-3 whitespace-pre-line text-sm leading-7 text-slate-600">{item.answer}</p></details>)}</div></section>;
  })}</main>;
}
