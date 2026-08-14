import type { Metadata, Viewport } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";

import { FORM_SUBMISSION_VERIFICATION_MESSAGE, LeadForm } from "@/components/lead-form";
import { PromoVideoPlayer } from "@/components/promo-video-player";
import { getPublicRegistrationForm } from "@/lib/public-registration-form";

type PublicFormPageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ submitted?: string }>;
};

function submittedVerificationMessage(successMessage: string) {
  return (
    <div className="grid gap-3" role="status" aria-live="polite">
      <p className="rounded-lg bg-emerald-50 p-4 text-sm font-medium text-emerald-800">{successMessage}</p>
      <p className="rounded-lg border border-emerald-100 bg-white p-4 text-sm leading-6 text-emerald-800">{FORM_SUBMISSION_VERIFICATION_MESSAGE}</p>
    </div>
  );
}

export async function generateMetadata({ params }: Pick<PublicFormPageProps, "params">): Promise<Metadata> {
  const { slug } = await params;
  const form = await getPublicRegistrationForm(slug);
  if (!form) {
    return {
      title: "報名頁不存在",
      robots: { index: false, follow: false },
    };
  }

  const title = form.seoTitle || form.headline;
  const description = form.seoDescription || form.description || undefined;
  return {
    title,
    description,
    robots: { index: true, follow: true },
    openGraph: {
      title,
      description,
      type: "website",
      ...(form.heroImageUrl ? { images: [form.heroImageUrl] } : {}),
    },
  };
}

export async function generateViewport({ params }: Pick<PublicFormPageProps, "params">): Promise<Viewport> {
  const { slug } = await params;
  const form = await getPublicRegistrationForm(slug);
  return form?.themeColor ? { themeColor: form.themeColor } : {};
}

export default async function PublicFormPage({ params, searchParams }: PublicFormPageProps) {
  const { slug } = await params;
  const query = await searchParams;
  const form = await getPublicRegistrationForm(slug);
  if (!form) notFound();

  const themeColor = form.themeColor ?? "#2563eb";
  const style = { "--registration-theme": themeColor } as React.CSSProperties;

  return (
    <main className="relative min-h-screen overflow-hidden bg-slate-100 px-4 py-8 sm:px-6" style={style}>
      {form.backgroundImageUrl ? (
        <div className="pointer-events-none absolute inset-0 opacity-20" aria-hidden="true">
          <Image src={form.backgroundImageUrl} alt="" fill unoptimized sizes="100vw" className="object-cover" />
        </div>
      ) : null}
      <section className="relative z-10 mx-auto w-full max-w-3xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
        {form.heroImageUrl ? (
          <Image src={form.heroImageUrl} alt="" width={1280} height={640} unoptimized className="aspect-[2/1] w-full object-cover" priority />
        ) : null}
        <div className="grid gap-6 p-5 sm:p-8">
          <header className="grid gap-2">
            <p className="text-sm font-semibold" style={{ color: "var(--registration-theme)" }}>{form.vendor.name}</p>
            <h1 className="text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">{form.headline}</h1>
            {form.description ? <p className="whitespace-pre-line text-sm leading-7 text-slate-600">{form.description}</p> : null}
          </header>

          {form.promoVideo ? (
            <section className="grid gap-2" aria-labelledby="registration-promo-video-title">
              <h2 id="registration-promo-video-title" className="text-sm font-bold text-slate-900">活動預告</h2>
              <PromoVideoPlayer src={form.promoVideo.videoUrl} title={form.promoVideo.title} />
            </section>
          ) : null}

          {form.stickyText ? <p className="rounded-xl border-l-4 border-[var(--registration-theme)] bg-slate-50 px-4 py-3 text-sm font-semibold leading-6 text-slate-700">{form.stickyText}</p> : null}
          {form.bodyContent ? <section className="whitespace-pre-line text-sm leading-7 text-slate-700" aria-label="活動內容">{form.bodyContent}</section> : null}
          {form.notice ? <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900" role="note">{form.notice}</p> : null}

          {!form.fields ? (
            <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
              這張表單的欄位設定需要商家重新確認，目前暫停接收資料。
            </div>
          ) : query.submitted === "verification_required" ? (
            submittedVerificationMessage(form.successMessage)
          ) : (
            <LeadForm
              formId={form.id}
              fields={form.fields}
              sessions={form.sessions}
              submitLabel={form.submitLabel}
              successMessage={form.successMessage}
              redirectTo={`/form/${form.slug}`}
              themeColor={themeColor}
            />
          )}
        </div>
      </section>
    </main>
  );
}
