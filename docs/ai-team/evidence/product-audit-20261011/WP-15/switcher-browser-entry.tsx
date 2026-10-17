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
import {AppShell} from "@/components/app-shell";
function Harness(){const [selectedProjectId,setSelectedProjectId]=React.useState<string|null>(null);return (<AppShell vendorName="合成商家" memberRole="owner" projects={[{id:"synthetic-project",name:"合成專案",status:"draft"}]} selectedProjectId={selectedProjectId} selectProject={async(id)=>{setSelectedProjectId(id);}} onboardingTasks={[{key:"start",title:"建立第一個專案",href:"/projects/new",status:"not_started",estimateMinutes:3}]} persistTaskPanelCollapsed={async()=>{}}><FunnelOperationsPanel initial={initial} initialStepId={content.activeStepId} csrfName="synthetic" csrfToken="synthetic" /></AppShell>);

}
createRoot(document.getElementById("root")!).render(<Harness/>);
