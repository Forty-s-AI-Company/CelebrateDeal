"use client";
import { useEffect, useState, type RefObject } from "react";
import { connectLiveMedia } from "@/lib/live-media-client";

export function LiveMediaReceiver({ videoRef, liveId, vendorId }: { videoRef: RefObject<HTMLVideoElement | null>; liveId: string; vendorId: string }) {
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let active = true;
    const failed = () => { if (active) setError("影音來源已中斷或尚未開播，請重試連線。"); };
    let connection: ReturnType<typeof connectLiveMedia> | undefined;
    try {
      connection = connectLiveMedia({ liveId, vendorId, direction: "read" }, { video, onFailure: failed });
      void connection.connected.then(() => { if (active) setError(""); }).catch(failed);
    } catch { failed(); }
    return () => { active = false; connection?.close(); };
  }, [liveId, vendorId, videoRef, retry]);
  return error ? <div className="absolute inset-0 grid place-content-center gap-3 bg-slate-950 p-5 text-center text-sm text-white" role="status"><p>{error}</p><button className="rounded border px-4 py-2" onClick={() => { setError(""); setRetry(value => value + 1); }}>重新連線</button></div> : null;
}
