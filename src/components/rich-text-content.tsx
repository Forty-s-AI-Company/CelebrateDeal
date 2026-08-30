import { Fragment } from "react";
import { parseRichText, type RichTextInline } from "@/lib/rich-text";

function RichTextInlines({ inlines }: { inlines: RichTextInline[] }) {
  return inlines.map((inline, index) => {
    const key = `${inline.type}-${index}`;
    if (inline.type === "strong") return <strong key={key}>{inline.value}</strong>;
    if (inline.type === "emphasis") return <em key={key}>{inline.value}</em>;
    if (inline.type === "link") return <a key={key} href={inline.href} target="_blank" rel="noreferrer" className="font-semibold text-primary underline underline-offset-2">{inline.label}</a>;
    return <Fragment key={key}>{inline.value.split("\n").map((line, lineIndex) => <Fragment key={lineIndex}>{lineIndex > 0 ? <br /> : null}{line}</Fragment>)}</Fragment>;
  });
}

export function RichTextContent({
  value,
  className = "",
}: {
  value: string;
  className?: string;
}) {
  return (
    <div className={`grid gap-3 ${className}`.trim()}>
      {parseRichText(value).map((block, index) => {
        const key = `${block.type}-${index}`;
        if (block.type === "heading") {
          const Tag = block.level === 2 ? "h2" : "h3";
          return <Tag key={key} className={block.level === 2 ? "text-xl font-bold text-slate-950" : "text-lg font-bold text-slate-900"}><RichTextInlines inlines={block.inlines} /></Tag>;
        }
        if (block.type === "unordered-list") return <ul key={key} className="list-disc space-y-1 pl-5">{block.items.map((item, itemIndex) => <li key={itemIndex}><RichTextInlines inlines={item} /></li>)}</ul>;
        if (block.type === "ordered-list") return <ol key={key} className="list-decimal space-y-1 pl-5">{block.items.map((item, itemIndex) => <li key={itemIndex}><RichTextInlines inlines={item} /></li>)}</ol>;
        return <p key={key}><RichTextInlines inlines={block.inlines} /></p>;
      })}
    </div>
  );
}
