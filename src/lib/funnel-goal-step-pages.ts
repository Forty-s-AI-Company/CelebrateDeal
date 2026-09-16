import { createFunnelFlow, type FunnelFlowInput } from "@/lib/funnel-flow";
import { createFunnelStepPages, parseFunnelStepPages, type FunnelStepPages } from "@/lib/funnel-step-pages";
import { instantiateFunnelTemplate } from "@/lib/funnel-template-gallery";
import type { FunnelNode } from "@/lib/funnel-page-document";

const primaryTemplate = { sell: "sell-product-checkout", audience: "audience-volunteer", custom: "custom-brand-info" } as const;

function informationalRoot(scope: string, headline: string, message: string): FunnelNode[] {
  const base = (id: string, type: FunnelNode["type"], props: Record<string, unknown>, children?: FunnelNode[]): FunnelNode => ({
    schemaVersion: 1, id: `${scope}_${id}`, type, props, style: {}, overrides: {}, visible: true, actions: [], attributes: {}, ...(children ? { children } : {}),
  });
  return [base("section", "section", {}, [base("row", "row", {}, [base("column", "columns_2", {}, [
    base("headline", "headline", { text: headline, level: "h1" }),
    base("message", "text", { text: message }),
  ])])])];
}

/** Creates the complete initial Funnel in one validated transaction. */
export function createGoalFunnelStepPages(input: FunnelFlowInput): FunnelStepPages | null {
  const flow = createFunnelFlow(input);
  if (!flow || flow.goal === "webinar") return null;
  const first = flow.steps[0];
  if (!first) return null;
  const primary = flow.goal === "custom" ? undefined : instantiateFunnelTemplate(primaryTemplate[flow.goal], `page_${flow.id}_${first.id}`);
  const state = createFunnelStepPages(flow, primary ? { initialPage: primary, initialStepId: first.id } : undefined);
  if (!state) return null;
  const next: FunnelStepPages = structuredClone(state);
  for (const step of flow.steps.slice(primary ? 1 : 0)) {
    const page = next.pages[step.id];
    if (!page) return null;
    page.root = step.isSystem
      ? informationalRoot(step.id, "此 Funnel 暫時無法使用", "這是系統停用頁。恢復 Funnel 後，訪客會回到正常流程。")
      : informationalRoot(step.id, step.type === "thank_you_page" ? "謝謝你完成這一步" : step.name, step.type === "thank_you_page" ? "你提供的資料已送出。接下來可在這裡說明後續流程。" : "請在編輯器中補上這個步驟的內容。");
  }
  return parseFunnelStepPages(next);
}
