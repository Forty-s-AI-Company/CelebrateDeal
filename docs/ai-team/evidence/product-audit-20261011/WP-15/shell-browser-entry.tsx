import React from "react";
import {createRoot} from "react-dom/client";
import {AppShell} from "@/components/app-shell";
import DashboardLoading from "@/app/(app)/dashboard/loading";
createRoot(document.getElementById("root")!).render(<AppShell vendorName="合成商家" memberRole="owner" isPlatformAdmin={new URLSearchParams(location.search).has("admin")} taskPanelCollapsed={new URLSearchParams(location.search).has("expanded") ? false : undefined} planLabel="測試方案" onboardingTasks={[{key:"synthetic",title:"建立第一個專案",href:"/projects/new",status:"not_started",estimateMinutes:3}]} persistTaskPanelCollapsed={async () => {}}><DashboardLoading /></AppShell>);
