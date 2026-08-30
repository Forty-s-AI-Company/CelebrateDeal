import Link from "next/link";
import type { PolicyDraft } from "@/lib/public-policy-content";
import { publicPolicyLinks } from "@/lib/public-policy-content";

export function PublicResourceLinks({ compact = false }: { compact?: boolean }) {
  return (
    <nav aria-label="公開資訊" className={compact ? "flex flex-wrap justify-center gap-x-4 gap-y-2 text-xs" : "grid gap-2 sm:grid-cols-2"}>
      {publicPolicyLinks.map((link) => (
        <Link key={link.href} href={link.href} className="font-semibold text-primary hover:underline">
          {link.label}
        </Link>
      ))}
    </nav>
  );
}

export function PublicPolicyShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-background px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <Link href="/policies" className="text-sm font-bold text-slate-950">CelebrateDeal</Link>
          <Link href="/login" className="min-h-11 inline-flex items-center rounded-md border border-border bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            返回登入
          </Link>
        </header>
        {children}
        <footer className="mt-12 border-t border-border pt-6">
          <PublicResourceLinks compact />
          <p className="mt-4 text-center text-xs leading-5 text-slate-700">
            目前頁面均為本機草稿；正式條款、隱私、退款、客服與商家 onboarding 仍需真人 owner 核准。
          </p>
        </footer>
      </div>
    </main>
  );
}

export function PolicyDraftNotice({ status, owner }: Pick<PolicyDraft, "status" | "owner">) {
  return (
    <aside role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
      <p className="font-bold">{status}</p>
      <p className="mt-1 leading-6">核准責任：{owner}。這個頁面不構成法律意見、正式政策或 release sign-off。</p>
    </aside>
  );
}

export function PolicyDocument({ draft }: { draft: PolicyDraft }) {
  return (
    <PublicPolicyShell>
      <article className="mx-auto max-w-3xl">
        <div className="mb-6">
          <p className="text-sm font-semibold text-primary">政策與協助中心</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">{draft.title}</h1>
          <p className="mt-3 text-base leading-7 text-slate-600">{draft.summary}</p>
        </div>
        <PolicyDraftNotice status={draft.status} owner={draft.owner} />
        <div className="mt-8 grid gap-6">
          {draft.sections.map((section) => (
            <section key={section.heading} className="rounded-lg border border-border bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-950">{section.heading}</h2>
              <div className="mt-3 grid gap-3 text-sm leading-6 text-slate-600">
                {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
              </div>
            </section>
          ))}
        </div>
      </article>
    </PublicPolicyShell>
  );
}
