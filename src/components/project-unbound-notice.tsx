/** Shown in the aggregate overview, where a new resource is created without a sales project. */
export function ProjectUnboundNotice({ resource }: { resource: string }) {
  return (
    <p role="status" className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
      你目前在「全部專案總覽」，新建立的{resource}不會歸屬任何專案。若要掛到特定專案，請先從側邊欄切換到該專案再建立。
    </p>
  );
}

/** Shown when a new resource will be created inside a sales project. */
export function ProjectBoundNotice({ name }: { name: string | null }) {
  if (!name) return null;
  return (
    <p role="status" className="mb-4 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-950">
      將建立於專案：{name}
    </p>
  );
}
