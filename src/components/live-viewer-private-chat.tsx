"use client";
import { useState } from "react";
import { LivePrivateConversationPanel } from "./live-private-conversation-panel";
export function LiveViewerPrivateChat({ vendorId, liveId }: { vendorId: string; liveId: string }) {
  const [open, setOpen] = useState(false);
  return <details className="border-b border-white/10 p-3 text-white" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer text-sm font-bold">講師私訊</summary>
    {open ? <div className="mt-3"><LivePrivateConversationPanel mode="viewer" vendorId={vendorId} liveId={liveId} /></div> : null}
  </details>;
}
