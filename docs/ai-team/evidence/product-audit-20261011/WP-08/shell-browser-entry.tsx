import React from "react";
import {createRoot} from "react-dom/client";
import {AppShell} from "@/components/app-shell";
import DashboardLoading from "@/app/(app)/dashboard/loading";
createRoot(document.getElementById("root")!).render(<AppShell vendorName="合成商家" memberRole="owner" planLabel="測試方案"><DashboardLoading /></AppShell>);
