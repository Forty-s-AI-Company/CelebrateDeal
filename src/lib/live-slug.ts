const SUFFIX_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

/** 產生 5 碼易讀的亂數尾碼（避免 0/o、1/l 混淆）。只在使用者操作時呼叫，不在 render 期間。 */
export function randomLiveSlugSuffix(length = 5): string {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => SUFFIX_ALPHABET[byte % SUFFIX_ALPHABET.length]).join("");
}

/**
 * 由直播標題產生預設直播網址。
 * 網址只使用小寫英數與連字號：標題中的英數字保留，中文等字元略過，
 * 並加上亂數尾碼避免撞名（例如「週五 New Arrivals」→ new-arrivals-k3x9p）。
 */
export function liveSlugFromTitle(title: string, suffix: string): string {
  const base = title
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  const safeSuffix = suffix.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12);
  return [base || "live", safeSuffix].filter(Boolean).join("-");
}

type LiveSlugLookup = {
  live: {
    findFirst(args: { where: { slug: string; id?: { not: string } }; select: { id: true } }): Promise<{ id: string } | null>;
  };
};

/**
 * 直播網址在全站唯一（`/live/<網址>` 是公開路徑）。只回傳「是否已被使用」，
 * 不回傳其他商家的任何資料；編輯時排除自己這場直播。
 */
export async function isLiveSlugTaken(db: LiveSlugLookup, slug: string, excludeLiveId: string | null): Promise<boolean> {
  const existing = await db.live.findFirst({
    where: { slug, ...(excludeLiveId ? { id: { not: excludeLiveId } } : {}) },
    select: { id: true },
  });
  // 查詢已排除自己；這裡再防禦一次，避免任何情況把自己這場直播判成撞名。
  return existing !== null && existing.id !== excludeLiveId;
}

export function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "P2002");
}

/** 撞名時要導回的頁面（欄位層級錯誤）；建立流程帶回草稿 id，草稿不會遺失。 */
export function liveSlugTakenPath(liveId: string | null, createDraftSuffix: string) {
  return liveId
    ? `/lives/${encodeURIComponent(liveId)}/edit?error=slug_taken`
    : `/lives/new?error=slug_taken${createDraftSuffix}`;
}

type DraftLookup = {
  liveStudioDraft: {
    findFirst(args: {
      where: { id: string; vendorId: string; revision: number; consumedAt: null; expiresAt: { gt: Date } };
      select: { id: true };
    }): Promise<{ id: string } | null>;
  };
};

/**
 * 送出前的撞名預檢。順序：ownership（呼叫端已驗證 existingLive）→ 草稿／版本衝突 → 撞名。
 * 網址被用掉時，若草稿已被 consume 或版本過期，優先回報草稿衝突；只有草稿仍可 claim
 * （真的會寫入）才回報撞名。
 */
export async function resolveLiveSlugConflict(
  db: LiveSlugLookup & DraftLookup,
  input: {
    vendorId: string;
    slug: string;
    existingLive: { id: string } | null;
    draftClaim: { draftId: string; revision: number };
  },
): Promise<"slug_taken" | "draft_conflict" | null> {
  if (!(await isLiveSlugTaken(db, input.slug, input.existingLive?.id ?? null))) return null;
  const claimable = await db.liveStudioDraft.findFirst({
    where: { id: input.draftClaim.draftId, vendorId: input.vendorId, revision: input.draftClaim.revision, consumedAt: null, expiresAt: { gt: new Date() } },
    select: { id: true },
  });
  return claimable ? "slug_taken" : "draft_conflict";
}

/**
 * 兩人同時搶同一個直播網址時，資料庫唯一鍵會擋下第二個；交易已回滾、草稿保留。
 * 只有確認是網址被用掉時才算（其他唯一鍵衝突照常拋出）。
 */
export async function isLiveSlugRace(db: LiveSlugLookup, error: unknown, slug: string, liveId: string | null): Promise<boolean> {
  return isUniqueConstraintError(error) && (await isLiveSlugTaken(db, slug, liveId));
}
