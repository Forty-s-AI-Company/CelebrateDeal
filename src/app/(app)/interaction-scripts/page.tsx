import Image from "next/image";
import Link from "next/link";
import { Copy, Pencil, Plus, Trash2 } from "lucide-react";
import { deleteInteractionScriptAction, duplicateInteractionScriptAction } from "@/app/actions";
import { CsrfField } from "@/components/csrf-field";
import { Badge, ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireVendor } from "@/lib/auth";
import { getDb } from "@/lib/db";

function pageHref(page: number, pageSize: number) {
  return `/interaction-scripts?page=${page}&pageSize=${pageSize}`;
}

export default async function InteractionScriptsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; pageSize?: string }>;
}) {
  const vendor = await requireVendor();
  const params = await searchParams;
  const pageSize = Number.parseInt(params.pageSize ?? "10", 10) || 10;
  const currentPage = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const totalItems = await getDb().interactionScript.count({ where: { vendorId: vendor.id } });
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const page = Math.min(currentPage, totalPages);
  const scripts = await getDb().interactionScript.findMany({
    where: { vendorId: vendor.id },
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * pageSize,
    take: pageSize,
    include: { events: { orderBy: { triggerSec: "asc" } }, lives: { include: { video: true } } },
  });

  return (
    <>
      <PageHeader title="留言組" description="管理直播互動腳本、綁定直播與影片，並快速複製整組節奏。" action={<ButtonLink href="/interaction-scripts/new"><Plus size={16} />新增留言組</ButtonLink>} />
      {scripts.length === 0 ? (
        <EmptyState title="還沒有留言組" description="建立留言組後，可綁定到直播間並依影片秒數自動觸發。" action={<ButtonLink href="/interaction-scripts/new">新增留言組</ButtonLink>} />
      ) : (
        <Card>
          <div className="grid gap-3">
            {scripts.map((script) => (
              <div key={script.id} className="grid gap-4 rounded-xl border border-border p-4 transition hover:-translate-y-0.5 hover:bg-slate-50 hover:shadow-md lg:grid-cols-[220px_1fr_auto]">
                <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-900">
                  <div className="relative aspect-video">
                    {script.lives[0]?.video?.thumbnailUrl ? (
                      <Image src={script.lives[0].video.thumbnailUrl} alt="" fill unoptimized className="object-cover" />
                    ) : (
                      <div className="grid h-full place-items-center bg-gradient-to-br from-slate-900 to-blue-950 text-sm font-semibold text-white/70">尚未綁定影片</div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
                    <div className="absolute bottom-2 left-2 right-2 text-white">
                      <p className="line-clamp-1 text-xs font-semibold">{script.lives[0]?.title ?? "尚未綁定直播"}</p>
                      <p className="line-clamp-1 text-[11px] text-white/70">{script.lives[0]?.video?.title ?? "可在直播間綁定"}</p>
                    </div>
                  </div>
                </div>

                <div className="min-w-0">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <h2 className="font-semibold text-slate-950">{script.name}</h2>
                      <p className="mt-1 text-sm text-slate-500">{script.description ?? "未填寫說明"}</p>
                    </div>
                    <div className="flex gap-2">
                      <Badge tone="blue">{script.status}</Badge>
                      <Badge tone="orange">{script.events.length} 句</Badge>
                      <Badge tone="gray">{script.lives.length} 直播</Badge>
                    </div>
                  </div>
                  <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
                    {script.events.slice(0, 8).map((event) => (
                      <span key={event.id} className="shrink-0 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                        {event.triggerSec}s · {event.title}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-2 lg:flex-col lg:justify-center">
                  <Link href={`/interaction-scripts/${script.id}/edit`} title="編輯" className="grid h-10 w-10 place-items-center rounded-md border border-border bg-white text-slate-600 shadow-sm hover:bg-blue-50 hover:text-primary">
                    <Pencil size={17} />
                  </Link>
                  <form action={duplicateInteractionScriptAction}>
                    <CsrfField />
                    <input type="hidden" name="id" value={script.id} />
                    <button title="複製" className="grid h-10 w-10 place-items-center rounded-md border border-border bg-white text-slate-600 shadow-sm hover:bg-blue-50 hover:text-primary">
                      <Copy size={17} />
                    </button>
                  </form>
                  <form action={deleteInteractionScriptAction}>
                    <CsrfField />
                    <input type="hidden" name="id" value={script.id} />
                    <button title="刪除" className="grid h-10 w-10 place-items-center rounded-md border border-red-100 bg-white text-red-500 shadow-sm hover:bg-red-50">
                      <Trash2 size={17} />
                    </button>
                  </form>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-5 flex flex-col gap-3 border-t border-border pt-4 md:flex-row md:items-center md:justify-between">
            <p className="text-sm text-slate-500">第 {page} / {totalPages} 頁，共 {totalItems} 筆</p>
            <div className="flex flex-wrap items-center gap-2">
              <form>
                <input type="hidden" name="page" value="1" />
                <select name="pageSize" defaultValue={String(pageSize)} className="h-9 rounded-md border border-border bg-white px-3 text-sm" aria-label="每頁筆數">
                  <option value="10">10 筆 / 頁</option>
                  <option value="20">20 筆 / 頁</option>
                  <option value="50">50 筆 / 頁</option>
                </select>
                <button className="ml-2 rounded-md border border-border px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">套用</button>
              </form>
              <Link href={pageHref(Math.max(1, page - 1), pageSize)} className="rounded-md border border-border px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">上一頁</Link>
              {Array.from({ length: totalPages }).slice(0, 7).map((_, index) => {
                const pageNumber = index + 1;
                return (
                  <Link key={pageNumber} href={pageHref(pageNumber, pageSize)} className={`grid h-9 w-9 place-items-center rounded-md border text-sm font-semibold ${pageNumber === page ? "border-primary bg-primary text-white" : "border-border text-slate-600 hover:bg-slate-50"}`}>
                    {pageNumber}
                  </Link>
                );
              })}
              <Link href={pageHref(Math.min(totalPages, page + 1), pageSize)} className="rounded-md border border-border px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">下一頁</Link>
            </div>
          </div>
        </Card>
      )}
    </>
  );
}
