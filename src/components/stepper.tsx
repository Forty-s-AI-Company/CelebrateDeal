"use client";

import { clsx } from "clsx";
import type { LucideIcon } from "lucide-react";

/**
 * A step's badge. Every status carries its own text (and optionally an icon),
 * so the state never relies on colour alone; `shortLabel` replaces the visible
 * text on phones while `label` stays the accessible text everywhere.
 */
export type StepperStatus = {
  label: string;
  shortLabel?: string;
  icon?: LucideIcon;
  /** Border, background and text classes of the badge. */
  className: string;
};

export type StepperStep<Key extends string> = {
  key: Key;
  label: string;
  /** Shown under the label on extra-wide screens only. */
  description?: string;
  icon?: LucideIcon;
  status?: StepperStatus;
  /** The id of the panel this step shows; becomes the button's `aria-controls`. */
  panelId?: string;
  disabled?: boolean;
};

// Static class names so Tailwind keeps them; more than six steps falls back to a wrapping grid.
const columnClass: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
  5: "grid-cols-5",
  6: "grid-cols-6",
};

/**
 * Step navigation for a wizard: a labelled <nav> with an ordered list of
 * native buttons. Every step stays reachable with Tab and is activated with
 * Enter／Space; the current step is `aria-current="step"`, and each button
 * names the panel it shows through `aria-controls`. On phones a one-line
 * 「第 n 步／共 N 步：…」 summary replaces the descriptions.
 *
 * It holds no state: the caller owns the active step and decides in
 * `onSelect` whether a jump is allowed (for example, blocking forward jumps
 * past a step with missing required fields). Focus stays on the pressed
 * button; moving focus into the panel is the caller's choice.
 */
export function Stepper<Key extends string>({
  label,
  steps,
  activeKey,
  onSelect,
  showPosition = true,
}: {
  /** Accessible name of the navigation landmark, e.g. 「直播設定步驟」. */
  label: string;
  steps: ReadonlyArray<StepperStep<Key>>;
  activeKey: Key;
  onSelect: (key: Key) => void;
  /** Renders the 「第 n 步／共 N 步：…」 line on phones (hidden from `md` up). */
  showPosition?: boolean;
}) {
  const position = steps.findIndex((step) => step.key === activeKey);
  return (
    <nav aria-label={label} className="grid gap-2">
      {showPosition && position >= 0 ? (
        <p className="text-sm font-semibold text-slate-900 md:hidden">
          第 {position + 1} 步／共 {steps.length} 步：{steps[position]?.label}
        </p>
      ) : null}
      <ol className={clsx("grid gap-2", columnClass[steps.length] ?? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4")}>
        {steps.map((step, index) => {
          const current = step.key === activeKey;
          const Icon = step.icon;
          const status = step.status;
          const StatusIcon = status?.icon;
          return (
            <li key={step.key} className="min-w-0">
              <button
                type="button"
                onClick={() => onSelect(step.key)}
                aria-controls={step.panelId}
                aria-current={current ? "step" : undefined}
                disabled={step.disabled}
                className={`flex h-full min-h-14 w-full flex-col items-center justify-center gap-1.5 rounded-md border px-1 py-2 text-center text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 md:items-start md:justify-start md:px-3 md:py-3 md:text-left ${
                  current
                    ? "border-primary bg-blue-50 text-primary"
                    : "border-border bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                }`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  {Icon ? (
                    <span aria-hidden="true" className={`hidden h-7 w-7 shrink-0 place-items-center rounded-full md:grid ${current ? "bg-white text-primary" : "bg-slate-100 text-slate-600"}`}>
                      <Icon size={15} />
                    </span>
                  ) : null}
                  <span className="block">{index + 1}. {step.label}</span>
                </span>
                {step.description ? <span className="hidden text-xs font-normal text-slate-600 xl:block">{step.description}</span> : null}
                {status ? (
                  <span className={`inline-flex max-w-full items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs font-medium ${status.className}`}>
                    {StatusIcon ? <StatusIcon size={12} aria-hidden="true" className="shrink-0" /> : null}
                    {status.shortLabel ? (
                      <>
                        <span aria-hidden="true" className="md:hidden">{status.shortLabel}</span>
                        <span className="sr-only md:not-sr-only">{status.label}</span>
                      </>
                    ) : (
                      <span>{status.label}</span>
                    )}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
