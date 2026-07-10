import { notFound } from "next/navigation";
import { LeadForm } from "@/components/lead-form";
import { getDb } from "@/lib/db";

function normalizeFields(fields: unknown) {
  if (!Array.isArray(fields)) return [];
  return fields.map((field) => ({
    key: String((field as { key?: string }).key ?? ""),
    label: String((field as { label?: string }).label ?? ""),
    type: String((field as { type?: string }).type ?? "text"),
    required: Boolean((field as { required?: boolean }).required),
  })).filter((field) => field.key && field.label);
}

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

  return (
    <main className="grid min-h-screen place-items-center bg-slate-100 px-4 py-8">
      <section className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-sm font-semibold text-blue-600">{form.vendor.name}</p>
        <h1 className="mt-2 text-2xl font-bold text-slate-950">{form.headline}</h1>
        {form.description ? <p className="mt-2 text-sm leading-6 text-slate-500">{form.description}</p> : null}
        <div className="mt-5">
          {query.submitted === "1" ? (
            <p className="rounded-lg bg-emerald-50 p-4 text-sm font-medium text-emerald-700">{form.successMessage}</p>
          ) : (
            <LeadForm
              formId={form.id}
              fields={normalizeFields(form.fields)}
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
