"use client";

import type { ReactNode } from "react";
import { Archive, RotateCcw } from "lucide-react";
import { FormSubmitButton } from "@/components/form-submit-button";

type VideoStatusAction = (formData: FormData) => void | Promise<void>;

type VideoLifecycleActionsProps = {
  archiveAction: VideoStatusAction;
  restoreAction: VideoStatusAction;
  csrfField: ReactNode;
  id: string;
  title: string;
  archived: boolean;
  references: {
    liveCount: number;
    registrationPageCount: number;
  };
};

export function VideoLifecycleActions({
  archiveAction,
  restoreAction,
  csrfField,
  id,
  title,
  archived,
  references,
}: VideoLifecycleActionsProps) {
  const actionLabel = archived ? "恢復" : "封存";
  const action = archived ? restoreAction : archiveAction;
  const confirmMessage = archived
    ? `確定要恢復「${title}」嗎？\n\n恢復後會回到封存前的狀態；Cloudflare 資源不會因恢復動作重新建立。`
    : `確定要封存「${title}」嗎？\n\n目前引用：${references.liveCount} 個直播場次、${references.registrationPageCount} 個報名頁。\n既有回放與關聯不會被刪除，封存只會隱藏並停止新的綁定。\nCloudflare Stream 資源不會被刪除。`;

  return (
    <form action={action} className="flex flex-wrap gap-2" aria-label={`${title}${actionLabel}`}>
      {csrfField}
      <input type="hidden" name="id" value={id} />
      <FormSubmitButton
        pendingChildren={`${actionLabel}中…`}
        pendingMessage={`正在${actionLabel}影片，請勿重複送出。`}
        confirmMessage={confirmMessage}
        className="inline-flex min-h-10 items-center gap-1.5 rounded-md border border-border bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
      >
        {archived ? <RotateCcw size={15} aria-hidden="true" /> : <Archive size={15} aria-hidden="true" />}
        {actionLabel}
      </FormSubmitButton>
    </form>
  );
}
