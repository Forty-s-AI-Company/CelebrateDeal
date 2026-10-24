"use client";

import { useLayoutEffect, useRef, useState, type ClipboardEvent, type CSSProperties, type DragEvent, type KeyboardEvent, type MouseEvent } from "react";
import { sanitizeFunnelInlineText } from "@/lib/funnel-inline-text";

/** Reads plain text from an editable element: text nodes, `<br>` and block breaks only. */
export function readEditableText(root: Node): string {
  let output = "";
  const walk = (parent: Node) => {
    parent.childNodes.forEach((child) => {
      if (child.nodeType === 3) output += child.nodeValue ?? "";
      else if (child.nodeName === "BR") output += "\n";
      else if (child.nodeType === 1) {
        if (/^(DIV|P|LI)$/u.test(child.nodeName) && output && !output.endsWith("\n")) output += "\n";
        walk(child);
      }
    });
  };
  walk(root);
  return output;
}

/** Inserts plain text at the caret inside `element` (end of the element when the caret is elsewhere). */
export function insertPlainText(element: HTMLElement, text: string) {
  const selection = element.ownerDocument.getSelection();
  const textNode = element.ownerDocument.createTextNode(text);
  if (!selection || selection.rangeCount === 0 || !element.contains(selection.anchorNode)) {
    element.append(textNode);
  } else {
    const range = selection.getRangeAt(0);
    range.deleteContents();
    range.insertNode(textNode);
  }
  const caret = element.ownerDocument.createRange();
  caret.setStartAfter(textNode);
  caret.collapse(true);
  selection?.removeAllRanges();
  selection?.addRange(caret);
}

/**
 * Native editing commands keep the browser's own undo stack and caret placement
 * (a manually inserted trailing "\n" leaves Chromium's caret before the break).
 * Falls back to manual plain-text insertion where they are unavailable.
 */
function insertWithBrowser(element: HTMLElement, text: string, lineBreak = false) {
  const document = element.ownerDocument;
  let handled = false;
  if (typeof document.execCommand === "function" && document.activeElement === element) {
    try { handled = lineBreak ? document.execCommand("insertLineBreak") : document.execCommand("insertText", false, text); } catch { handled = false; }
  }
  if (!handled) insertPlainText(element, text);
}

function placeCaret(element: HTMLElement, point?: { x: number; y: number }) {
  const document = element.ownerDocument;
  const selection = document.getSelection();
  if (!selection) return;
  let range: Range | null = null;
  const pointDocument = document as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null; caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null };
  if (point && typeof pointDocument.caretPositionFromPoint === "function") {
    const position = pointDocument.caretPositionFromPoint(point.x, point.y);
    if (position && element.contains(position.offsetNode)) {
      range = document.createRange();
      range.setStart(position.offsetNode, position.offset);
    }
  } else if (point && typeof pointDocument.caretRangeFromPoint === "function") {
    const candidate = pointDocument.caretRangeFromPoint(point.x, point.y);
    if (candidate && element.contains(candidate.startContainer)) range = candidate;
  }
  if (!range) {
    range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
  }
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function supportsPlaintextOnly() {
  try {
    const probe = document.createElement("div");
    probe.contentEditable = "plaintext-only";
    return probe.contentEditable === "plaintext-only";
  } catch {
    return false;
  }
}

export type InlineEditableTextProps = {
  as: "p" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "span" | "li";
  className?: string;
  /** Same inline style the rendered element uses, so editing never changes the look. */
  style?: CSSProperties;
  /** Text shown when editing started; the element is uncontrolled while editing. */
  initial: string;
  multiline: boolean;
  /** Accessible name, e.g. 「編輯標題」. */
  label: string;
  caret?: { x: number; y: number };
  onCommit: (value: string) => void;
  onCancel: () => void;
};

/**
 * Canvas inline editor, mounted only by the editor-mode renderer. Enter or
 * blur commits once, Escape cancels, pasted or dropped content becomes plain
 * text and Shift+Enter adds a line break only where the node keeps them.
 */
export function InlineEditableText({ as, className = "", style, initial, multiline, label, caret, onCommit, onCancel }: InlineEditableTextProps) {
  const ref = useRef<HTMLElement>(null);
  const finished = useRef(false);
  // Read once: later prop changes must not reset what is being typed.
  const start = useRef({ initial, caret });
  const [editableMode] = useState<"plaintext-only" | "true">(() => (supportsPlaintextOnly() ? "plaintext-only" : "true"));

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.textContent = start.current.initial;
    element.focus({ preventScroll: true });
    placeCaret(element, start.current.caret);
  }, []);

  function finish(commit: boolean) {
    if (finished.current) return;
    finished.current = true;
    const element = ref.current;
    if (commit && element) onCommit(readEditableText(element));
    else onCancel();
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      finish(false);
    } else if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      if (event.shiftKey && multiline) insertWithBrowser(event.currentTarget, "\n", true);
      else if (!event.shiftKey) finish(true);
    }
  }

  function onPaste(event: ClipboardEvent<HTMLElement>) {
    event.preventDefault();
    const text = sanitizeFunnelInlineText(event.clipboardData.getData("text/plain"), multiline);
    if (text) insertWithBrowser(event.currentTarget, text);
  }

  const Tag = as;
  return <Tag ref={(element: HTMLElement | null) => { ref.current = element; }}
    role="textbox" aria-label={label} aria-multiline={multiline}
    contentEditable={editableMode} suppressContentEditableWarning spellCheck data-funnel-inline-editing="true"
    className={`${className} cursor-text rounded-sm outline-2 outline-offset-2 outline-blue-500 whitespace-pre-wrap`.trim()} style={style}
    onKeyDown={onKeyDown} onPaste={onPaste} onBlur={() => finish(true)}
    // External drops (HTML, files) never enter the editable; canvas drags ignore it too.
    onDragOver={(event: DragEvent) => { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = "none"; }}
    onDrop={(event: DragEvent) => { event.preventDefault(); event.stopPropagation(); }}
    onClick={(event: MouseEvent) => event.stopPropagation()}
    onDoubleClick={(event: MouseEvent) => event.stopPropagation()} />;
}
