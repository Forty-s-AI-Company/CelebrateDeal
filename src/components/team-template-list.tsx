"use client";

import { useActionState, useState } from "react";
import { Copy, ExternalLink, Link2Off, Plus, Users } from "lucide-react";
import { Badge, ButtonLink, Card, EmptyState } from "@/components/ui";

export type TeamTemplateListItem = {
  id: string;
  name: string;
  teamId: string;
  teamName: string;
  status: "ACTIVE" | "DRAFT" | string;
  latestVersion: number;
  copiedPartnerCount: number;
  sourcePage: { id: string; slug: string; shareEnabled: boolean } | null;
};

type TeamTemplateActionState = { status: "idle" | "success" | "error"; message: string; shareUrl?: string; sharePageId?: string };
type TemplateAction = (state: TeamTemplateActionState, formData: FormData) => Promise<TeamTemplateActionState>;
const initialActionState: TeamTemplateActionState = { status: "idle", message: "" };

export function TeamTemplateList({ templates, csrfToken, action }: { templates: TeamTemplateListItem[]; csrfToken: string; action: TemplateAction }) {
  const [state, formAction, pending] = useActionState(action, initialActionState);
  const [copied, setCopied] = useState(false);

  async function copyShareUrl() {
    if (!state.shareUrl) return;
    await navigator.clipboard?.writeText(new URL(state.shareUrl, window.location.origin).toString());
    setCopied(true);
  }

  if (templates.length === 0) {
    return (
      <EmptyState
        title="還沒有團隊模板"
        description="先建立一個原始頁，設定夥伴可編輯與鎖定的內容，再發給團隊夥伴複製使用。"
        action={<ButtonLink href="/team-templates/new" tone="cta"><Plus size={16} />建立第一個模板</ButtonLink>}
      />
    );
  }

  return (
    <div className="grid gap-4">
      {state.status !== "idle" ? (
        <div role="status" className={state.status === "success" ? "rounded-md bg-emerald-50 p-3 text-sm text-emerald-800" : "rounded-md bg-red-50 p-3 text-sm text-red-800"}>
          {state.message}
          {state.shareUrl ? (
            <span className="mt-2 flex flex-wrap items-center gap-2">
              <code className="max-w-full overflow-x-auto rounded bg-white px-2 py-1 text-xs text-slate-700">{state.shareUrl}</code>
              <button type="button" onClick={copyShareUrl} className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-white px-2 py-1 text-xs font-semibold text-emerald-800">
                <Copy size={13} />{copied ? "已複製" : "複製分享連結"}
              </button>
            </span>
          ) : null}
        </div>
      ) : null}
      <Card>
        <div className="grid gap-3">
          {templates.map((template) => (
            <article key={template.id} className="grid gap-4 rounded-lg border border-border p-4 lg:grid-cols-[1fr_auto] lg:items-center">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-semibold text-slate-950">{template.name}</h2>
                  <Badge tone={template.status === "ACTIVE" ? "green" : "gray"}>{template.status === "ACTIVE" ? "已發布" : "草稿"}</Badge>
                  <Badge tone="blue">v{template.latestVersion}</Badge>
                </div>
                <p className="mt-1 text-sm text-slate-500">{template.teamName} · 已複製給 {template.copiedPartnerCount} 位夥伴</p>
                <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
                  {template.sourcePage ? <span>原始頁：/p/{template.sourcePage.slug}</span> : <span className="text-orange-700">沒有可分享的原始頁</span>}
                  {template.sourcePage ? <Badge tone={template.sourcePage.shareEnabled ? "green" : "gray"}>{template.sourcePage.shareEnabled ? "分享啟用中" : "分享已停用"}</Badge> : null}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <ButtonLink href={`/team-templates/${template.id}/edit`} tone="secondary"><ExternalLink size={16} />編輯與發版</ButtonLink>
                {template.sourcePage?.shareEnabled ? (
                  <form
                    action={formAction}
                    onSubmit={(event) => {
                      if (!window.confirm("確定要停用這個分享連結？已發出的連結會立刻失效。")) event.preventDefault();
                    }}
                  >
                    <input type="hidden" name="_csrf" value={csrfToken} />
                    <input type="hidden" name="operation" value="disable-share" />
                    <input type="hidden" name="teamId" value={template.teamId} />
                    <input type="hidden" name="pageId" value={template.sourcePage.id} />
                    <button disabled={pending} className="inline-flex h-10 items-center gap-2 rounded-md border border-red-200 px-3 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"><Link2Off size={16} />{pending ? "處理中…" : "停用分享"}</button>
                  </form>
                ) : template.sourcePage ? (
                  <form action={formAction}>
                    <input type="hidden" name="_csrf" value={csrfToken} />
                    <input type="hidden" name="operation" value="create-share" />
                    <input type="hidden" name="teamId" value={template.teamId} />
                    <input type="hidden" name="pageId" value={template.sourcePage.id} />
                    <button disabled={pending} className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-3 text-sm font-semibold text-white disabled:opacity-60"><Users size={16} />{pending ? "建立中…" : "建立分享連結"}</button>
                  </form>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      </Card>
    </div>
  );
}
