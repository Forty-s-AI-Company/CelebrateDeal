import React,{useState} from "react";
import {createRoot} from "react-dom/client";
import {AppShell} from "@/components/app-shell";
import {PageHeader,ButtonLink} from "@/components/ui";
import {DashboardKpiContent} from "wp15-kpi";
import {calculateAnalyticsFunnel} from "@/lib/analytics-funnel";
function Fixture(){
 const [active,setActive]=useState(false);
 const data={registrationCount:0,verifiedRegistrationCount:0,viewerMessageCount:0,scheduledMessageCount:0,orderCreatedCount:0,emailSentCount:0,emailFailedCount:0,viewCount:active?5:0,productClicks:0,funnel:calculateAnalyticsFunnel({views:active?5:0,productClicks:0,ctaClicks:0,submissions:0})};
 return <AppShell vendorName="合成商家" memberRole="owner" planLabel="測試方案" projects={[]} selectProject={async()=>{}} onboardingTasks={[{key:"synthetic",title:"建立第一個專案",href:"/projects/new",status:"not_started",estimateMinutes:3}]} persistTaskPanelCollapsed={async()=>{}}>
 <PageHeader title="營運總覽" description="直播導購營運總覽：觀看、名單、商品點擊、聯盟來源與用量配額。" action={<ButtonLink href="/lives/new" tone="cta">建立直播</ButtonLink>}/>
 <DashboardKpiContent data={data}/>
 <button className="mt-4 min-h-11 rounded border p-3" onClick={()=>setActive(true)}>切換合成活動資料</button>
 </AppShell>;
}
createRoot(document.getElementById("root")).render(<Fixture/>);
