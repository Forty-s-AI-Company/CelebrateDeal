import type { FunnelNode, FunnelNodeType } from "@/lib/funnel-page-document";
import type { FunnelNodePatch, FunnelPageCommand } from "@/lib/funnel-page-history";

/**
 * Inline (on-canvas) text editing rules (EDT-INT-001). The canvas only ever
 * produces plain text; this module decides which prop it writes, sanitises the
 * text and turns one finished edit into exactly one history command.
 */
export type FunnelInlineField = {
  /** Prop written by the edit. */
  key: "text" | "label" | "items";
  /** Whether line breaks are kept (Shift+Enter) or folded into spaces. */
  multiline: boolean;
  /** Edited entry for list nodes. */
  itemIndex?: number;
};

export const FUNNEL_INLINE_TEXT_MAX_LENGTH = 10_000;

/** Node types editable on the canvas; lists need the clicked item's index. */
export function funnelInlineField(type: FunnelNodeType, itemIndex?: number): FunnelInlineField | null {
  switch (type) {
    case "text": return { key: "text", multiline: true };
    case "headline": return { key: "text", multiline: false };
    case "button": return { key: "label", multiline: false };
    case "bulleted_list": return Number.isInteger(itemIndex) && itemIndex! >= 0 ? { key: "items", multiline: false, itemIndex } : null;
    default: return null;
  }
}

export function isFunnelInlineEditable(type: FunnelNodeType): boolean {
  return funnelInlineField(type, 0) !== null;
}

// Control characters (except tab/newline), zero-width and bidi override marks.
const unsafeCharacters = /[\u0000-\u0008\u000b-\u001f\u007f​-‏‪-‮⁠-⁤﻿]/gu;

/**
 * Normalises pasted or typed content to plain text: unified newlines, no
 * control or invisible formatting characters, non-breaking spaces as spaces.
 * Single-line fields fold line breaks into one space.
 */
export function sanitizeFunnelInlineText(raw: string, multiline: boolean): string {
  let text = raw.replace(/\r\n?/gu, "\n").replace(unsafeCharacters, "").replace(/\t/gu, " ").replace(/ /gu, " ");
  if (multiline) text = text.split("\n").map((line) => line.replace(/ +$/u, "")).join("\n").replace(/\n{3,}/gu, "\n\n");
  else text = text.replace(/\s*\n\s*/gu, " ");
  return text.trim().slice(0, FUNNEL_INLINE_TEXT_MAX_LENGTH);
}

export type FunnelInlineCommitInput = {
  node: FunnelNode;
  field: FunnelInlineField;
  viewport: "desktop" | "mobile";
  /** Text the canvas displayed when editing started. */
  previous: string;
  /** Raw text read from the editable element. */
  value: string;
  /** Displayed list entries (list nodes only). */
  items?: readonly string[];
};

/**
 * One finished inline edit → one `update` command (undo restores the previous
 * text in a single step). Returns null when nothing changed or the result
 * would be empty. When the current viewport already overrides the prop, the
 * override is edited so the canvas keeps showing what was typed.
 */
export function funnelInlineTextCommand({ node, field, viewport, previous, value, items }: FunnelInlineCommitInput): FunnelPageCommand | null {
  const text = sanitizeFunnelInlineText(value, field.multiline);
  let next: string | string[];
  if (field.key === "items") {
    const list = [...(items ?? [])];
    const index = field.itemIndex ?? -1;
    if (index < 0 || index >= Math.max(list.length, 1)) return null;
    if (!text) {
      // Clearing an entry removes it, but a list always keeps one entry.
      if (list.length <= 1) return null;
      list.splice(index, 1);
    } else {
      if (list[index] === text) return null;
      list[index] = text;
    }
    next = list;
  } else {
    if (!text || text === sanitizeFunnelInlineText(previous, field.multiline)) return null;
    next = text;
  }
  const override = node.overrides[viewport]?.props;
  const patch: FunnelNodePatch = override && Object.hasOwn(override, field.key)
    ? { overrides: { [viewport]: { props: { [field.key]: next } } } }
    : { props: { [field.key]: next } };
  return { type: "update", nodeId: node.id, patch };
}
