export function isLivePubliclyAccessible(status: string, replayEnabled: boolean) {
  if (status === "scheduled" || status === "live") return true;
  return status === "ended" && replayEnabled;
}

export type LivePublicationIssue = "vod_video_required" | "vod_video_not_ready" | "live_input_required" | "live_input_mapping_required";

export function getLivePublicationIssue(input: {
  status: string;
  streamMode: string;
  videoId: string | null;
  videoStatus: string | null;
  cloudflareLiveInputUid: string | null;
}): LivePublicationIssue | null {
  if (!["scheduled", "live", "ended"].includes(input.status)) return null;
  if (input.streamMode === "live") {
    if (!input.cloudflareLiveInputUid) return "live_input_required";
    return input.videoId ? null : "live_input_mapping_required";
  }
  if (!input.videoId) return "vod_video_required";
  return input.videoStatus === "ready" ? null : "vod_video_not_ready";
}

export function hasForeignLiveRelations(live: {
  vendorId: string;
  video: { vendorId: string } | null;
  form: { vendorId: string } | null;
  interactionScript: null | {
    vendorId: string;
    events: Array<{ productId: string | null; role: { vendorId: string } | null }>;
  };
  products: Array<{ productId: string; product: { vendorId: string } }>;
}) {
  return Boolean(live.video && live.video.vendorId !== live.vendorId)
    || Boolean(live.form && live.form.vendorId !== live.vendorId)
    || Boolean(live.interactionScript && live.interactionScript.vendorId !== live.vendorId)
    || live.products.some((item) => item.product.vendorId !== live.vendorId)
    || Boolean(live.interactionScript?.events.some((event) =>
      Boolean(event.role && event.role.vendorId !== live.vendorId)
      || Boolean(event.productId && !live.products.some((item) => item.productId === event.productId)),
    ));
}
