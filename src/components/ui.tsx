import Link from "next/link";
import { clsx } from "clsx";

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
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold text-slate-950">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-sm text-slate-500">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Card({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <section className={clsx("rounded-lg border border-border bg-white p-5 shadow-sm", className)}>{children}</section>;
}

export function ButtonLink({
  href,
  children,
  tone = "primary",
}: {
  href: string;
  children: React.ReactNode;
  tone?: "primary" | "secondary" | "cta";
}) {
  return (
    <Link
      href={href}
      className={clsx(
        "inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold transition",
        tone === "primary" && "bg-primary text-white hover:bg-primary-dark",
        tone === "cta" && "bg-cta text-white hover:bg-cta-dark",
        tone === "secondary" && "border border-border bg-white text-slate-700 hover:bg-slate-50",
      )}
    >
      {children}
    </Link>
  );
}

export function SubmitButton({ children = "儲存" }: { children?: React.ReactNode }) {
  return (
    <button className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-white transition hover:bg-primary-dark">
      {children}
    </button>
  );
}

export function DangerButton({ children }: { children: React.ReactNode }) {
  return (
    <button className="inline-flex h-10 items-center justify-center rounded-md bg-red-600 px-4 text-sm font-semibold text-white transition hover:bg-red-700">
      {children}
    </button>
  );
}

export function Field({
  label,
  name,
  defaultValue,
  type = "text",
  required,
  placeholder,
}: {
  label: string;
  name: string;
  defaultValue?: string | number | null;
  type?: string;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="grid gap-1.5 text-sm font-medium text-slate-700">
      {label}
      <input
        className="h-10 rounded-md border border-border bg-white px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-blue-100"
        name={name}
        type={type}
        required={required}
        placeholder={placeholder}
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
}: {
  label: string;
  name: string;
  defaultValue?: string | null;
  rows?: number;
  placeholder?: string;
}) {
  return (
    <label className="grid gap-1.5 text-sm font-medium text-slate-700">
      {label}
      <textarea
        className="rounded-md border border-border bg-white px-3 py-2 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-blue-100"
        name={name}
        rows={rows}
        placeholder={placeholder}
        defaultValue={defaultValue ?? ""}
      />
    </label>
  );
}

export function SelectField({
  label,
  name,
  defaultValue,
  children,
}: {
  label: string;
  name: string;
  defaultValue?: string | null;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-1.5 text-sm font-medium text-slate-700">
      {label}
      <select
        className="h-10 rounded-md border border-border bg-white px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-blue-100"
        name={name}
        defaultValue={defaultValue ?? ""}
      >
        {children}
      </select>
    </label>
  );
}

export function Badge({ children, tone = "blue" }: { children: React.ReactNode; tone?: "blue" | "orange" | "gray" | "green" }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold",
        tone === "blue" && "bg-blue-50 text-blue-700",
        tone === "orange" && "bg-orange-50 text-orange-700",
        tone === "green" && "bg-emerald-50 text-emerald-700",
        tone === "gray" && "bg-slate-100 text-slate-600",
      )}
    >
      {children}
    </span>
  );
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return (
    <Card className="flex flex-col items-center justify-center py-12 text-center">
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      <p className="mt-2 max-w-md text-sm text-slate-500">{description}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </Card>
  );
}
