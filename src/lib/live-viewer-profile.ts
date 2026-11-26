import { createHash, randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { INTERACTION_AVATAR_SEEDS, interactionRoleAvatarUrl } from "@/lib/interaction-role";
import { hashLiveViewerToken } from "@/lib/live-quota-admission";

/**
 * 觀眾在直播間的暱稱與頭像（owner 2026-11-26，參考幫賣）。
 *
 * - 身分：長效、不透明的 profile cookie。資料庫只存它與 liveId 的雜湊，同一個
 *   瀏覽器回到同一場直播就沿用；不同直播的列無法互相連結。admission 的
 *   viewer session 只活 90 秒、離開就刪除，不能當作「記住」的依據。
 * - 範圍：所有讀寫都綁定 admission session 這一列的 vendorId／liveId（伺服器
 *   紀錄），client 傳來的值只用來比對。
 * - 不可重複：同一場直播內其他觀眾的暱稱（資料庫唯一鍵）、這場直播綁定的互動
 *   腳本中啟用角色的名稱、主辦（vendor）名稱，以及預設的「觀眾」。
 */

export const LIVE_VIEWER_PROFILE_COOKIE = "celebratedeal_live_profile";
export const LIVE_VIEWER_PROFILE_COOKIE_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;
export const LIVE_VIEWER_NICKNAME_MAX_LENGTH = 20;
const PROFILE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const ADMISSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const RAW_NICKNAME_MAX_LENGTH = 200;
/** 聊天室在沒有名字時顯示的預設名稱，觀眾不能拿來當暱稱。 */
const RESERVED_NICKNAMES = ["觀眾"] as const;

export const LIVE_VIEWER_AVATAR_SEEDS: readonly string[] = Object.freeze([
  ...INTERACTION_AVATAR_SEEDS.male,
  ...INTERACTION_AVATAR_SEEDS.female,
]);
const avatarSeedSet = new Set(LIVE_VIEWER_AVATAR_SEEDS);
const avatarSeedByUrl = new Map(LIVE_VIEWER_AVATAR_SEEDS.map((seed) => [interactionRoleAvatarUrl(seed), seed]));

export type LiveViewerNicknameProblem = "empty" | "too_long" | "invalid_characters" | "contains_url";

export type LiveViewerProfileErrorCode =
  | "access_denied"
  | "invalid_nickname"
  | "invalid_avatar"
  | "nickname_taken";

export class LiveViewerProfileError extends Error {
  constructor(
    public readonly code: LiveViewerProfileErrorCode,
    public readonly problem: LiveViewerNicknameProblem | null = null,
  ) {
    super(code);
    this.name = "LiveViewerProfileError";
  }
}

export const LIVE_VIEWER_NICKNAME_TAKEN_MESSAGE = "這個名稱已經有人使用，請換一個";

export function liveViewerProfileErrorMessage(error: LiveViewerProfileError) {
  if (error.code === "nickname_taken") return LIVE_VIEWER_NICKNAME_TAKEN_MESSAGE;
  if (error.code === "invalid_avatar") return "請從清單中選擇頭像";
  if (error.code === "access_denied") return "直播連線已失效，請重新進入直播間";
  if (error.problem === "empty") return "請輸入暱稱";
  if (error.problem === "too_long") return `暱稱最多 ${LIVE_VIEWER_NICKNAME_MAX_LENGTH} 個字`;
  if (error.problem === "contains_url") return "暱稱不能包含網址";
  return "暱稱含有無法使用的字元";
}

export const LiveViewerProfileScopeSchema = z.object({
  vendorId: z.string().trim().min(1).max(128),
  liveId: z.string().trim().min(1).max(128),
}).strict();

export const LiveViewerProfileSaveSchema = z.object({
  vendorId: z.string().trim().min(1).max(128),
  liveId: z.string().trim().min(1).max(128),
  nickname: z.string().max(RAW_NICKNAME_MAX_LENGTH),
  avatarSeed: z.string().max(64).optional(),
  avatarUrl: z.string().max(512).optional(),
}).strict();

// Control, format (zero-width, bidi override), line/paragraph separators and
// private-use code points never belong in a display name.
const FORBIDDEN_CHARACTERS = /[\p{Cc}\p{Cf}\p{Co}\p{Zl}\p{Zp}]/u;
// A scheme, "www." or a host with a common top-level domain ("abc.com",
// "line.me"); initials such as "J.Lo" or "Mr.Smith" stay allowed.
const URL_PATTERNS = [
  /[a-z][a-z0-9+.-]*:\/\//iu,
  /(?:^|[^a-z0-9])www\./iu,
  /[a-z0-9-]\.(?:com|net|org|edu|gov|tw|io|co|me|app|cc|info|biz|xyz|top|shop|site|online|link|ly|gl|gg|tv|hk|cn|jp|us|uk)(?![a-z0-9])/iu,
];

/**
 * The comparison key for "is this name already used": NFKC (full-width →
 * half-width), case-insensitive, every whitespace removed. Used for viewer
 * nicknames, scripted role names and the vendor name alike.
 */
export function liveViewerNicknameKey(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[\s\p{Z}\p{Cf}]/gu, "");
}

export type NormalizedLiveViewerNickname =
  | { ok: true; nickname: string; key: string }
  | { ok: false; problem: LiveViewerNicknameProblem };

export function normalizeLiveViewerNickname(value: unknown): NormalizedLiveViewerNickname {
  if (typeof value !== "string") return { ok: false, problem: "empty" };
  if (value.length > RAW_NICKNAME_MAX_LENGTH) return { ok: false, problem: "too_long" };
  const normalized = value.normalize("NFKC");
  if (FORBIDDEN_CHARACTERS.test(normalized)) return { ok: false, problem: "invalid_characters" };
  const nickname = normalized.replace(/[\s\p{Z}]+/gu, " ").trim();
  if (!nickname) return { ok: false, problem: "empty" };
  if (Array.from(nickname).length > LIVE_VIEWER_NICKNAME_MAX_LENGTH) return { ok: false, problem: "too_long" };
  if (URL_PATTERNS.some((pattern) => pattern.test(nickname))) return { ok: false, problem: "contains_url" };
  const key = liveViewerNicknameKey(nickname);
  if (!key) return { ok: false, problem: "empty" };
  return { ok: true, nickname, key };
}

/**
 * A registrant's name as a nickname suggestion: cut to the length limit and
 * returned only when it would pass validation. Never reveals another viewer.
 */
export function suggestLiveViewerNickname(name: string | null | undefined) {
  if (!name) return null;
  const cut = Array.from(name.normalize("NFKC").replace(/[\s\p{Z}]+/gu, " ").trim())
    .slice(0, LIVE_VIEWER_NICKNAME_MAX_LENGTH)
    .join("");
  const result = normalizeLiveViewerNickname(cut);
  return result.ok ? result.nickname : null;
}

/** Only the 20 preset seeds, given as the seed or as its canonical URL. */
export function resolveLiveViewerAvatarSeed(input: { avatarSeed?: string | null; avatarUrl?: string | null }) {
  if (input.avatarSeed !== undefined && input.avatarSeed !== null) {
    return avatarSeedSet.has(input.avatarSeed) ? input.avatarSeed : null;
  }
  if (input.avatarUrl !== undefined && input.avatarUrl !== null) {
    return avatarSeedByUrl.get(input.avatarUrl) ?? null;
  }
  return null;
}

/** Public avatar URL of a stored seed; anything outside the presets has none. */
export function liveViewerAvatarUrl(seed: string | null | undefined) {
  return seed && avatarSeedSet.has(seed) ? interactionRoleAvatarUrl(seed) : null;
}

export function createLiveViewerProfileToken() {
  return randomBytes(32).toString("base64url");
}

export function isLiveViewerProfileToken(value: string | null | undefined): value is string {
  return typeof value === "string" && PROFILE_TOKEN_PATTERN.test(value);
}

/** Per-live hash: the same cookie maps to unrelated keys in different lives. */
export function hashLiveViewerProfileKey(token: string, liveId: string) {
  return createHash("sha256").update(`live-viewer-profile:v1:${liveId}:${token}`, "utf8").digest("hex");
}

function readCookieValue(header: string | null, name: string) {
  if (!header || header.length > 8_192) return null;
  let found: string | null = null;
  for (const segment of header.split(";")) {
    const separator = segment.indexOf("=");
    if (separator < 0 || segment.slice(0, separator).trim() !== name) continue;
    if (found !== null) return null;
    try {
      found = decodeURIComponent(segment.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return found;
}

export function liveViewerProfileTokenFromRequest(request: Request) {
  const token = readCookieValue(request.headers.get("cookie"), LIVE_VIEWER_PROFILE_COOKIE);
  return isLiveViewerProfileToken(token) ? token : null;
}

export function liveViewerProfileCookieOptions(request: Request) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: new URL(request.url).protocol === "https:",
    path: "/",
    maxAge: LIVE_VIEWER_PROFILE_COOKIE_MAX_AGE_SECONDS,
  };
}

export type LiveViewerProfileView = {
  nickname: string;
  avatarSeed: string;
  avatarUrl: string;
};

type ProfileRow = { id: string; nickname: string; avatarSeed: string };

function toView(row: ProfileRow | null): LiveViewerProfileView | null {
  if (!row) return null;
  const avatarUrl = liveViewerAvatarUrl(row.avatarSeed);
  return avatarUrl ? { nickname: row.nickname, avatarSeed: row.avatarSeed, avatarUrl } : null;
}

type ProfileModels = Pick<PrismaClient, "liveViewerSession" | "liveViewerProfile" | "live">;

/**
 * The (vendorId, liveId) of the caller's active admission, read from the
 * server-side session row. Client-sent ids must equal it; every later query
 * uses these server values.
 */
export async function resolveLiveViewerProfileScope(
  database: Pick<PrismaClient, "liveViewerSession">,
  input: { vendorId: string; liveId: string; admissionToken: string | null; now?: Date },
) {
  if (!input.admissionToken || !ADMISSION_TOKEN_PATTERN.test(input.admissionToken)) {
    throw new LiveViewerProfileError("access_denied");
  }
  const session = await database.liveViewerSession.findUnique({
    where: { tokenHash: hashLiveViewerToken(input.admissionToken) },
    select: { vendorId: true, liveId: true, expiresAt: true },
  });
  const now = input.now ?? new Date();
  if (!session || session.vendorId !== input.vendorId || session.liveId !== input.liveId || session.expiresAt <= now) {
    throw new LiveViewerProfileError("access_denied");
  }
  return { vendorId: session.vendorId, liveId: session.liveId };
}

/** The profile row of this cookie in this live, or null. Callers own the scope. */
export async function findLiveViewerProfile(
  database: Pick<PrismaClient, "liveViewerProfile">,
  scope: { vendorId: string; liveId: string },
  profileToken: string | null,
) {
  if (!isLiveViewerProfileToken(profileToken)) return null;
  return database.liveViewerProfile.findUnique({
    where: {
      vendorId_liveId_viewerKeyHash: {
        vendorId: scope.vendorId,
        liveId: scope.liveId,
        viewerKeyHash: hashLiveViewerProfileKey(profileToken, scope.liveId),
      },
    },
    select: { id: true, nickname: true, avatarSeed: true },
  });
}

/**
 * Names a viewer may not take in this live: the vendor (brand) name, every
 * active role of the live's own interaction script, and the default "觀眾".
 * Only this vendor's script and roles count.
 */
export async function reservedLiveViewerNicknameKeys(
  database: Pick<PrismaClient, "live">,
  scope: { vendorId: string; liveId: string },
) {
  const live = await database.live.findFirst({
    where: { id: scope.liveId, vendorId: scope.vendorId },
    select: {
      vendor: { select: { name: true } },
      interactionScript: {
        select: {
          vendorId: true,
          events: {
            where: { role: { is: { vendorId: scope.vendorId, isActive: true } } },
            select: { role: { select: { name: true } } },
          },
        },
      },
    },
  });
  if (!live) throw new LiveViewerProfileError("access_denied");
  const names = [
    ...RESERVED_NICKNAMES,
    live.vendor.name,
    ...(live.interactionScript?.vendorId === scope.vendorId
      ? live.interactionScript.events.map((event) => event.role?.name ?? "")
      : []),
  ];
  return new Set(names.map(liveViewerNicknameKey).filter(Boolean));
}

export async function readLiveViewerProfile(
  database: ProfileModels,
  input: { vendorId: string; liveId: string; admissionToken: string | null; profileToken: string | null; now?: Date },
) {
  const scope = await resolveLiveViewerProfileScope(database, input);
  return toView(await findLiveViewerProfile(database, scope, input.profileToken));
}

function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

function uniqueTarget(error: unknown) {
  if (typeof error !== "object" || error === null || !("meta" in error)) return "";
  const meta = (error as { meta?: { target?: unknown } }).meta;
  const target = meta?.target;
  return Array.isArray(target) ? target.join(",") : typeof target === "string" ? target : "";
}

export type SaveLiveViewerProfileResult = {
  profile: LiveViewerProfileView;
  /** Set only when the caller had no profile cookie; the route must store it. */
  issuedProfileToken: string | null;
};

/**
 * Creates or renames this viewer's profile in one live. Validation and the
 * reserved-name check run first; the (vendorId, liveId, normalizedNickname)
 * unique index decides races between viewers. Every write is keyed by the
 * admission session's vendorId and liveId.
 */
export async function saveLiveViewerProfile(
  database: ProfileModels,
  input: {
    vendorId: string;
    liveId: string;
    admissionToken: string | null;
    profileToken: string | null;
    nickname: unknown;
    avatarSeed?: string | null;
    avatarUrl?: string | null;
    now?: Date;
  },
): Promise<SaveLiveViewerProfileResult> {
  const scope = await resolveLiveViewerProfileScope(database, input);
  const nickname = normalizeLiveViewerNickname(input.nickname);
  if (!nickname.ok) throw new LiveViewerProfileError("invalid_nickname", nickname.problem);
  const avatarSeed = resolveLiveViewerAvatarSeed(input);
  if (!avatarSeed) throw new LiveViewerProfileError("invalid_avatar");

  const reserved = await reservedLiveViewerNicknameKeys(database, scope);
  if (reserved.has(nickname.key)) throw new LiveViewerProfileError("nickname_taken");

  const profileToken = isLiveViewerProfileToken(input.profileToken) ? input.profileToken : createLiveViewerProfileToken();
  const issuedProfileToken = profileToken === input.profileToken ? null : profileToken;
  const viewerKeyHash = hashLiveViewerProfileKey(profileToken, scope.liveId);
  const data = { nickname: nickname.nickname, normalizedNickname: nickname.key, avatarSeed };

  // The same viewer can race itself (two tabs); the loser of the
  // viewerKeyHash insert retries once as an update.
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const row = await database.liveViewerProfile.upsert({
        where: {
          vendorId_liveId_viewerKeyHash: { vendorId: scope.vendorId, liveId: scope.liveId, viewerKeyHash },
        },
        create: { vendorId: scope.vendorId, liveId: scope.liveId, viewerKeyHash, ...data },
        update: data,
        select: { id: true, nickname: true, avatarSeed: true },
      });
      const profile = toView(row);
      if (!profile) throw new Error("Saved live viewer profile was not safe to project.");
      return { profile, issuedProfileToken };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      if (uniqueTarget(error).includes("normalizedNickname")) throw new LiveViewerProfileError("nickname_taken");
      // Any other unique race (this viewer's own row was inserted by a
      // parallel request): the retry updates that row, and a nickname clash
      // then reports as taken.
      if (attempt === 1) continue;
      throw new LiveViewerProfileError("nickname_taken");
    }
  }
  throw new LiveViewerProfileError("nickname_taken");
}
