import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import type { FunnelRuntimeDecision } from "@/lib/funnel-runtime";
import { RegistrationClosedFeedback } from "./registration-closed-feedback";
import { hasRegistrationFeedbackQuery } from "./registration-retry-boundary";

/** 截止規則先決定可用性；只有結果查詢才留在原來源提供唯讀內容。 */
export function registrationDeadlineOutcome({ decision, query, form, slug, withRetry }: {
  decision: FunnelRuntimeDecision;
  query: { registrationRetry?: string; submitted?: string };
  form?: { id: string; fields: Array<{ key: string; label: string }> };
  slug: string;
  withRetry: (children: ReactNode) => ReactNode;
}) {
  if (decision.status !== "closed" && decision.status !== "redirect") return null;
  const destination = decision.status === "redirect" ? `/lp/${encodeURIComponent(slug)}/${encodeURIComponent(decision.path)}` : undefined;
  if (hasRegistrationFeedbackQuery(query)) return withRetry(<RegistrationClosedFeedback formId={form?.id} fields={form?.fields} destination={destination} />);
  if (destination) redirect(destination);
  return <main className="mx-auto max-w-2xl px-6 py-24 text-center"><h1 className="text-2xl font-black text-slate-950">此活動已截止</h1><p className="mt-3 text-slate-600">目前不再接受新的瀏覽或送出資料。</p></main>;
}
