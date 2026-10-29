import { parsePageDocument, type FunnelNode, type PageDocument } from "@/lib/funnel-page-document";

/**
 * Webinar 範本壓力文案（docs/product/webinar-templates/qa-standards.md §4）。
 * 純函式：只改 props，不改節點 id 與結構；僅供 browser-qa harness 與測試使用。
 */
export const STRESS_LONG_TOKEN = "Abcdefghij0123456789ABCDEFGHIJklmnopqrstuvwxyz-0123456789_ABCDEFGHIJ".slice(0, 60);
export const STRESS_ZH_SPEAKER_NAME = "歐陽慕容司徒諸葛尉遲上官";
export const STRESS_EN_SPEAKER_NAME = "Alexandria Montgomery-Christensen";
export const STRESS_TESTIMONIAL_TEXT = "上完這堂課之後我才發現，原來過去自己花了很多時間在錯誤的方向上打轉。老師把複雜的觀念拆解成可以立刻執行的步驟，每一個範例都貼近真實的工作情境，讓我可以當天就回到公司實際套用。三個月後，團隊的轉換率明顯提升，主管也願意把更多預算交給我們運作。我最喜歡的是課後的社群討論，大家會分享自己的實作成果與卡關的地方，常常一個提問就能得到好幾種解法。".padEnd(300, "。").slice(0, 300);
const MAX_ITEMS = 8;

type Props = Record<string, unknown>;
const isRecord = (value: unknown): value is Props => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** 加長 1.5 倍：原文後面再接原文前半段。 */
function lengthen(value: string): string {
  if (!value.trim()) return value;
  const extra = value.slice(0, Math.ceil(value.length / 2));
  return /[A-Za-z0-9]$/u.test(value) ? `${value} ${extra}` : `${value}${extra}`;
}

function lengthenProp(props: Props, keys: readonly string[]): Props {
  const key = keys.find((candidate) => typeof props[candidate] === "string" && (props[candidate] as string).trim());
  return key ? { ...props, [key]: lengthen(props[key] as string) } : props;
}

function padItems(value: unknown): unknown {
  if (!Array.isArray(value) || value.length === 0 || value.length >= MAX_ITEMS) return value;
  const items = value.slice();
  const template = items.filter(isRecord);
  if (!template.length) return value;
  for (let index = items.length; index < MAX_ITEMS; index += 1) items.push({ ...template[index % template.length]! });
  return items;
}

type Counters = { speaker: number; tokenPlaced: boolean };

function stressProps(node: FunnelNode, counters: Counters): Props {
  const props = node.props;
  switch (node.type) {
    case "headline": return lengthenProp(props, ["text", "content", "title"]);
    case "button": return lengthenProp(props, ["label", "text", "title"]);
    case "text": {
      let next = lengthenProp(props, ["text", "content", "body"]);
      if (!counters.tokenPlaced) {
        const key = ["text", "content", "body"].find((candidate) => typeof next[candidate] === "string");
        if (key) { next = { ...next, [key]: `${next[key] as string} ${STRESS_LONG_TOKEN}` }; counters.tokenPlaced = true; }
      }
      return next;
    }
    case "speaker_profiles": {
      if (!Array.isArray(props.items)) return props;
      const items = props.items.map((item) => {
        if (!isRecord(item)) return item;
        const name = counters.speaker % 2 === 0 ? STRESS_ZH_SPEAKER_NAME : STRESS_EN_SPEAKER_NAME;
        counters.speaker += 1;
        return { ...item, name };
      });
      return { ...props, items };
    }
    case "icon_list":
    case "agenda_timeline": return props.items === undefined ? props : { ...props, items: padItems(props.items) };
    case "stats": {
      if (!Array.isArray(props.items)) return props;
      const items = props.items.map((item, index) => {
        if (!isRecord(item)) return item;
        if (index === 0) return { ...item, value: "1280000", prefix: "NT$" };
        if (index === 1) return { ...item, value: "12345", suffix: "+" };
        return item;
      });
      return { ...props, items };
    }
    case "testimonial_wall": {
      if (!Array.isArray(props.items)) return props;
      return { ...props, items: props.items.map((item) => isRecord(item) ? { ...item, text: STRESS_TESTIMONIAL_TEXT } : item) };
    }
    default: return props;
  }
}

function stressNodes(nodes: FunnelNode[], counters: Counters): FunnelNode[] {
  return nodes.map((node) => ({
    ...node,
    props: stressProps(node, counters),
    ...(node.children ? { children: stressNodes(node.children, counters) } : {}),
  }));
}

export function stressFunnelDocument(document: PageDocument): PageDocument {
  const counters: Counters = { speaker: 0, tokenPlaced: false };
  const stressed = { ...document, root: stressNodes(document.root, counters) };
  // 壓力文案必須仍是合法文件；若超過長度上限則退回原文件，避免 harness 靜默載入壞資料。
  return parsePageDocument(stressed) ?? document;
}
