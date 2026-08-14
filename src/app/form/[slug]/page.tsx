import { notFound } from "next/navigation";
import { FORM_SUBMISSION_VERIFICATION_MESSAGE, LeadForm } from "@/components/lead-form";
import { getDb } from "@/lib/db";
import { parseRegistrationFormFields } from "@/lib/registration-form-fields";

export default async function PublicFormPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ submitted?: string }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const form = await getDb().registrationForm.findUnique({ where: { slug }, include: { vendor: true } });
  if (!form || !form.isActive) notFound();
  const fields = parseRegistrationFormFields(form.fields);

  return (
    <main className="grid min-h-screen place-items-center bg-slate-100 px-4 py-8">
      <section className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-sm font-semibold text-blue-600">{form.vendor.name}</p>
        <h1 className="mt-2 text-2xl font-bold text-slate-950">{form.headline}</h1>
        {form.description ? <p className="mt-2 text-sm leading-6 text-slate-500">{form.description}</p> : null}
        <div className="mt-5">
          {!fields.success ? (
            <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
              這張表單的欄位設定需要商家重新確認，目前暫停接收資料。
            </div>
          ) : query.submitted === "verification_required" ? (
            <p role="status" className="rounded-lg bg-emerald-50 p-4 text-sm font-medium text-emerald-700">{FORM_SUBMISSION_VERIFICATION_MESSAGE}</p>
          ) : (
            <LeadForm
              formId={form.id}
              fields={fields.data}
              submitLabel={form.submitLabel}
              successMessage={form.successMessage}
              redirectTo={`/form/${form.slug}`}
            />
          )}
        </div>
      </section>
    </main>
  );
}
