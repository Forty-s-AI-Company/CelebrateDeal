"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { clsx } from "clsx";

export type TabItem<Key extends string> = {
  key: Key;
  label: ReactNode;
  disabled?: boolean;
};

/** The id of the tab for `key`; its panel points back to it with `aria-labelledby`. */
export function tabId(idPrefix: string, key: string) {
  return `${idPrefix}-tab-${key}`;
}

/** The id of the panel for `key`; the tab points to it with `aria-controls`. */
export function tabPanelId(idPrefix: string, key: string) {
  return `${idPrefix}-panel-${key}`;
}

const nextKeys = { horizontal: "ArrowRight", vertical: "ArrowDown" } as const;
const previousKeys = { horizontal: "ArrowLeft", vertical: "ArrowUp" } as const;

/**
 * A WAI-ARIA tablist with automatic activation: the arrow keys (←／→, or
 * ↑／↓ when vertical) move to the previous／next enabled tab and wrap around,
 * Home／End jump to the first／last enabled tab, and the tab that receives
 * focus is selected at once. Only the selected tab is in the Tab order
 * (roving tabindex), so Tab moves from the tablist straight into the panel.
 *
 * The caller owns the selected key and renders the panels with `TabPanel`
 * (or any element using `tabPanelId`／`tabId`), mounting only the selected
 * one or hiding the others.
 */
export function Tabs<Key extends string>({
  idPrefix,
  label,
  items,
  value,
  onChange,
  orientation = "horizontal",
  className,
}: {
  /** Prefix for the tab and panel ids; must be unique on the page. */
  idPrefix: string;
  /** Accessible name of the tablist. */
  label: string;
  items: ReadonlyArray<TabItem<Key>>;
  value: Key;
  onChange: (key: Key) => void;
  orientation?: "horizontal" | "vertical";
  /** Extra classes for the tablist, e.g. outer margins. */
  className?: string;
}) {
  const tabRefs = useRef(new Map<Key, HTMLButtonElement>());

  function select(key: Key) {
    onChange(key);
    tabRefs.current.get(key)?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, key: Key) {
    const enabled = items.filter((item) => !item.disabled);
    if (enabled.length === 0) return;
    const index = enabled.findIndex((item) => item.key === key);
    let target: TabItem<Key> | undefined;
    if (event.key === nextKeys[orientation]) target = enabled[(index + 1) % enabled.length];
    else if (event.key === previousKeys[orientation]) target = enabled[(index - 1 + enabled.length) % enabled.length];
    else if (event.key === "Home") target = enabled[0];
    else if (event.key === "End") target = enabled[enabled.length - 1];
    if (!target) return;
    event.preventDefault();
    select(target.key);
  }

  const vertical = orientation === "vertical";
  // A disabled selected tab cannot take focus; keep the first enabled tab reachable instead.
  const focusableKey = items.find((item) => item.key === value && !item.disabled)?.key ?? items.find((item) => !item.disabled)?.key;
  return (
    <div
      role="tablist"
      aria-label={label}
      aria-orientation={vertical ? "vertical" : undefined}
      className={clsx(vertical ? "flex flex-col gap-1 border-r border-slate-200" : "flex gap-1 border-b border-slate-200", className)}
    >
      {items.map((item) => {
        const selected = item.key === value;
        return (
          <button
            key={item.key}
            ref={(element) => {
              if (element) tabRefs.current.set(item.key, element);
              else tabRefs.current.delete(item.key);
            }}
            id={tabId(idPrefix, item.key)}
            role="tab"
            type="button"
            aria-selected={selected}
            aria-controls={tabPanelId(idPrefix, item.key)}
            tabIndex={item.key === focusableKey ? 0 : -1}
            disabled={item.disabled}
            onKeyDown={(event) => onKeyDown(event, item.key)}
            onClick={() => onChange(item.key)}
            className={clsx(
              "min-h-11 px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50",
              vertical ? "-mr-px border-r-2 text-left" : "-mb-px border-b-2",
              selected ? "border-blue-700 text-slate-950" : "border-transparent text-slate-600 hover:text-slate-900",
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

/** The panel of one tab: labelled by its tab and pointed to by the tab's `aria-controls`. */
export function TabPanel({
  idPrefix,
  tabKey,
  children,
  className,
  focusable = false,
}: {
  idPrefix: string;
  tabKey: string;
  children: ReactNode;
  className?: string;
  /** Put the panel itself in the Tab order; use it when the panel has no focusable content. */
  focusable?: boolean;
}) {
  return (
    <section id={tabPanelId(idPrefix, tabKey)} role="tabpanel" aria-labelledby={tabId(idPrefix, tabKey)} tabIndex={focusable ? 0 : undefined} className={className}>
      {children}
    </section>
  );
}
