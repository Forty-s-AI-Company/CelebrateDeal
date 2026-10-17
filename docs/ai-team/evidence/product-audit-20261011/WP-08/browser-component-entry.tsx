import React from "react";
import { createRoot } from "react-dom/client";
import { FunnelElementInspector } from "@/components/landing-pages/funnel-element-inspector";
import { FunnelOperationsPanel } from "@/components/landing-pages/funnel-operations-panel";
import { createGoalFunnelStepPages } from "@/lib/funnel-goal-step-pages";
import { defaultFunnelOperations } from "@/lib/funnel-operations";
import type { FunnelNode } from "@/lib/funnel-page-document";
const mode = new URLSearchParams(location.search).get("mode");
const content = createGoalFunnelStepPages({ id: "synthetic", name: "合成網站", goal: "audience", domain: "synthetic" })!;
for (const step of content.flow.steps) if (!step.isSystem) step.template = { source: "blank" };
const initial = { pageId: "synthetic", name: "合成網站", slug: "synthetic", currency: "TWD", revision: 2, status: "draft" as const, operations: defaultFunnelOperations(), content, formId: null, liveId: null, steps: content.flow.steps.filter((x) => !x.isSystem).map(({ id, name, path }) => ({ id, name, path })) };
const node: FunnelNode = { schemaVersion: 1, id: "synthetic_button", type: "button", props: { label: "下一步" }, style: {}, overrides: {}, visible: true, attributes: {}, actions: mode === "popup" ? [{ type: "show_popup", popupId: "popup_alpha" }] : [{ type: "next_step", stepId: "step_alpha" }] };
function Harness() {
 const [targetsPresent, setTargetsPresent] = React.useState(true);
 const [currentNode, setCurrentNode] = React.useState(node);
 return (<main className="p-6">{mode === "operations" ? <FunnelOperationsPanel initial={initial} initialStepId={content.activeStepId} csrfName="synthetic" csrfToken="synthetic" /> : <><button onClick={() => setTargetsPresent(false)}>移除合成目標</button><button onClick={() => { setTargetsPresent(true); setCurrentNode({ ...node, actions: mode === "popup" ? [{ type: "show_popup", popupId: "popup_beta" }] : [{ type: "next_step", stepId: "step_beta" }] }); }}>模擬復原動作</button><h1 className="mb-4 text-xl font-bold">元件動作設定</h1><FunnelElementInspector node={currentNode} stepIds={targetsPresent ? ["step_alpha", "step_beta"] : []} stepNames={{ step_alpha: "報名頁", step_beta: "感謝頁" }} popupIds={targetsPresent ? ["popup_alpha", "popup_beta"] : []} popupNames={{ popup_alpha: "活動提醒", popup_beta: "優惠通知" }} onCommand={(command) => { (window as unknown as { lastSyntheticCommand: unknown }).lastSyntheticCommand = command; }} /></>}</main>);
}
createRoot(document.getElementById("root")!).render(<Harness />);
