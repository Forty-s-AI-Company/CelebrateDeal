import Link from "next/link";
import { ArrowRight, Inbox } from "lucide-react";
import { clsx } from "clsx";
import { FormSubmitButton } from "@/components/form-submit-button";

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="mb-7 flex min-w-0 flex-col gap-4 border-b border-slate-200/80 pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight text-slate-950 [overflow-wrap:anywhere] sm:text-[1.75rem]">{title}</h1>
        {description ? <p className="mt-1.5 max-w-3xl text-sm leading-6 text-slate-600 [overflow-wrap:anywhere]">{description}</p> : null}
      </div>
      {action ? <div className="w-full sm:w-auto [&>*]:w-full sm:[&>*]:w-auto">{action}</div> : null}
    </header>
  );
}

export function Card({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <section className={clsx("rounded-xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-6", className)}>{children}</section>;
}

export function ButtonLink({
  href,
  children,
  tone = "primary",
  prefetch,
}: {
  href: string;
  children: React.ReactNode;
  tone?: "primary" | "secondary" | "cta";
  /** Keeps the Next.js default unless a caller explicitly opts out. */
  prefetch?: boolean;
}) {
  return (
    <Link
      href={href}
      prefetch={prefetch}
      className={clsx(
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50",
        tone === "primary" && "bg-primary text-white hover:bg-primary-dark",
        tone === "cta" && "bg-cta text-white hover:bg-cta-dark",
        tone === "secondary" && "border border-border bg-white text-slate-700 hover:bg-slate-50",
      )}
    >
      {children}
    </Link>
  );
}

export function SubmitButton({
  children = "儲存",
  pendingChildren = "儲存中…",
  pendingMessage = "正在儲存，請勿重複送出。",
  disabled = false,
}: {
  children?: React.ReactNode;
  pendingChildren?: React.ReactNode;
  pendingMessage?: string;
  disabled?: boolean;
}) {
  return (
    <FormSubmitButton
      pendingChildren={pendingChildren}
      pendingMessage={pendingMessage}
      disabled={disabled}
      className="inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </FormSubmitButton>
  );
}

export function DangerButton({ children }: { children: React.ReactNode }) {
  return (
    <FormSubmitButton
      pendingChildren="處理中…"
      pendingMessage="正在處理，請勿重複送出。"
      className="inline-flex min-h-11 items-center justify-center rounded-md bg-red-600 px-4 text-sm font-semibold text-white transition hover:bg-red-700"
    >
      {children}
    </FormSubmitButton>
  );
}

export function Field({
  label,
  name,
  defaultValue,
  type = "text",
  required,
  placeholder,
  autoComplete,
  minLength,
  maxLength,
  min,
  max,
  step,
  readOnly,
}: {
  label: string;
  name: string;
  defaultValue?: string | number | null;
  type?: string;
  required?: boolean;
  placeholder?: string;
  autoComplete?: string;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  step?: number;
  readOnly?: boolean;
}) {
  return (
    <label className="grid gap-1.5 text-sm font-medium text-slate-700">
      {label}
      <input
        className="h-11 rounded-lg border border-border bg-white px-3 text-sm outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-primary focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
        name={name}
        type={type}
        required={required}
        placeholder={placeholder}
        autoComplete={autoComplete}
        minLength={minLength}
        maxLength={maxLength}
        min={min}
        max={max}
        step={step}
        readOnly={readOnly}
        defaultValue={defaultValue ?? ""}
      />
    </label>
  );
}

export function TextArea({
  label,
  name,
  defaultValue,
  rows = 4,
  placeholder,
  required,
  maxLength,
}: {
  label: string;
  name: string;
  defaultValue?: string | null;
  rows?: number;
  placeholder?: string;
  required?: boolean;
  maxLength?: number;
}) {
  return (
    <label className="grid gap-1.5 text-sm font-medium text-slate-700">
      {label}
      <textarea
        className="rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-primary focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-100"
        name={name}
        rows={rows}
        placeholder={placeholder}
        required={required}
        maxLength={maxLength}
        defaultValue={defaultValue ?? ""}
      />
    </label>
  );
}

export function SelectField({
  label,
  name,
  defaultValue,
  value,
  onChange,
  required,
  children,
}: {
  label: string;
  name: string;
  defaultValue?: string | null;
  value?: string;
  onChange?: React.ChangeEventHandler<HTMLSelectElement>;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-1.5 text-sm font-medium text-slate-700">
      {label}
      <select
        className="h-11 rounded-lg border border-border bg-white px-3 text-sm outline-none transition hover:border-slate-300 focus:border-primary focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-100"
        name={name}
        required={required}
        onChange={onChange}
        {...(value === undefined ? { defaultValue: defaultValue ?? "" } : { value })}
      >
        {children}
      </select>
    </label>
  );
}

export function Badge({ children, tone = "blue" }: { children: React.ReactNode; tone?: "blue" | "orange" | "gray" | "green" | "red" }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold",
        tone === "blue" && "bg-blue-50 text-blue-700",
        tone === "orange" && "bg-orange-50 text-orange-700",
        tone === "green" && "bg-emerald-50 text-emerald-700",
        tone === "red" && "bg-red-50 text-red-700",
        tone === "gray" && "bg-slate-100 text-slate-600",
      )}
    >
      {children}
    </span>
  );
}

export function EmptyState({ title, description, action, secondaryAction, icon }: { title: string; description: string; action?: React.ReactNode; secondaryAction?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <Card className="relative flex min-h-72 flex-col items-center justify-center overflow-hidden border-dashed bg-slate-50/40 py-12 text-center">
      <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl border border-blue-100 bg-blue-50 text-primary shadow-sm" aria-hidden="true">
        {icon ?? <Inbox size={25} strokeWidth={1.8} />}
      </div>
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      <p className="mt-2 max-w-md text-sm leading-6 text-slate-600">{description}</p>
      {action || secondaryAction ? <div className="mt-5 flex w-full max-w-md flex-col items-stretch justify-center gap-2 sm:w-auto sm:max-w-none sm:flex-row sm:items-center [&>*]:w-full sm:[&>*]:w-auto">{action}{secondaryAction}</div> : null}
    </Card>
  );
}

export function FormLayout({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className={clsx("mx-auto grid w-full max-w-6xl gap-6", aside && "xl:grid-cols-[minmax(0,1fr)_320px] xl:items-start")}>
      <div className="min-w-0">{children}</div>
      {aside ? <aside className="min-w-0 xl:sticky xl:top-6">{aside}</aside> : null}
    </div>
  );
}

export function FormSection({ title, description, children, className }: { title: string; description?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={clsx("rounded-xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-6", className)}>
      <div className="mb-5 border-b border-slate-100 pb-4">
        <h2 className="text-base font-semibold text-slate-950">{title}</h2>
        {description ? <p className="mt-1 text-sm leading-6 text-slate-500">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

export function AdvancedSettings({ title = "進階設定", description, children }: { title?: string; description?: string; children: React.ReactNode }) {
  return (
    <details className="group rounded-xl border border-slate-200 bg-slate-50/70">
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 px-5 text-sm font-semibold text-slate-700 marker:hidden">
        <span><span className="block">{title}</span>{description ? <span className="mt-0.5 block text-xs font-normal text-slate-500">{description}</span> : null}</span>
        <ArrowRight size={17} className="shrink-0 transition group-open:rotate-90" aria-hidden="true" />
      </summary>
      <div className="grid gap-4 border-t border-slate-200 px-5 py-5">{children}</div>
    </details>
  );
}

export function FormActions({ children }: { children: React.ReactNode }) {
  return <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 bg-white/95 px-1 py-4 backdrop-blur">{children}</div>;
}

export function ListSummary({ items }: { items: Array<{ label: string; value: React.ReactNode; hint?: string }> }) {
  return (
    <dl className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => <div key={item.label} className="rounded-xl border border-slate-200/80 bg-white px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        <dt className="text-xs font-medium text-slate-500">{item.label}</dt>
        <dd className="mt-1">
          <div className="text-2xl font-bold tracking-tight text-slate-950 tabular-nums">{item.value}</div>
          {item.hint ? <p className="mt-1 text-xs text-slate-500">{item.hint}</p> : null}
        </dd>
      </div>)}
    </dl>
  );
}
