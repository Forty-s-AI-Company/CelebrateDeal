import { createHash, randomBytes } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { INTERACTION_AVATAR_SEEDS, interactionRoleAvatarUrl } from "@/lib/interaction-role";
import { hashLiveViewerToken } from "@/lib/live-quota-admission";

/**
 * 觀眾在直播間的暱稱與頭像（owner 2026-11-26，參考幫賣）。
 *
 * 這是顯示用的名字，不是安全控制：它不證明身分、不給任何權限，留言門檻仍是
 * 已驗證 Email 的報名；擋入場只在前端，伺服器的播放來源不檢查暱稱。
 *
 * - 身分：長效、不透明的 profile cookie。資料庫只存它與 liveId 的雜湊，同一個
 *   瀏覽器回到同一場直播就沿用；不同直播的列無法互相連結。admission 的
 *   viewer session 只活 90 秒、離開就刪除，不能當作「記住」的依據。
 * - 範圍：所有讀寫都綁定 admission session 這一列的 vendorId／liveId（伺服器
 *   紀錄），client 傳來的值只用來比對。
 * - 「直播間」＝這場直播（liveId）：聊天訊息本身只以 liveId 分，指定場次與
 *   常青場的各場次共用同一個聊天室，所以名稱唯一性也以 liveId 為範圍；改用
 *   「7 天沒活動就不再佔用名稱」避免常青場的名字永遠被佔住。
 * - 不可重複：同一場直播內其他觀眾的暱稱（資料庫唯一鍵）、這場直播綁定的互動
 *   腳本中啟用角色的名稱、主辦（vendor）名稱、預設的「觀眾」，以及近 7 天
 *   在這場直播以報名姓名留言、沒有暱稱的觀眾名字。
 * - 商家的關鍵字與身分黑名單同樣適用（由呼叫端傳入 moderation）。
 */

export const LIVE_VIEWER_PROFILE_COOKIE = "celebratedeal_live_profile";
/** Only `/api/live-viewer-profile` and `/api/live-chat/messages` read it. */
export const LIVE_VIEWER_PROFILE_COOKIE_PATH = "/api";
export const LIVE_VIEWER_PROFILE_COOKIE_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;
export const LIVE_VIEWER_NICKNAME_MAX_LENGTH = 20;
/** A profile idle this long no longer holds its name. */
export const LIVE_VIEWER_NICKNAME_HOLD_MS = 7 * 24 * 60 * 60 * 1_000;
/** New profiles one admission session may create in one live. */
export const LIVE_VIEWER_PROFILES_PER_ADMISSION = 3;
/** lastActiveAt is refreshed at most this often. */
const ACTIVITY_REFRESH_MS = 60 * 60 * 1_000;
/** Distinct recent chat author names read for the reserved names. */
const RECENT_AUTHOR_SCAN_LIMIT = 5_000;
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
  | "blocked"
  | "invalid_nickname"
  | "nickname_blocked"
  | "invalid_avatar"
  | "nickname_taken"
  | "too_many_profiles";

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
export const LIVE_VIEWER_NICKNAME_BLOCKED_MESSAGE = "這個名稱無法使用，請換一個";

export function liveViewerProfileErrorMessage(error: LiveViewerProfileError) {
  if (error.code === "nickname_taken") return LIVE_VIEWER_NICKNAME_TAKEN_MESSAGE;
  if (error.code === "nickname_blocked") return LIVE_VIEWER_NICKNAME_BLOCKED_MESSAGE;
  if (error.code === "invalid_avatar") return "請從清單中選擇頭像";
  if (error.code === "access_denied") return "直播連線已失效，請重新進入直播間";
  if (error.code === "blocked") return "目前無法設定暱稱";
  if (error.code === "too_many_profiles") return "操作太頻繁，請稍後再試";
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
// private-use code points never belong in a display name. ZWJ/ZWNJ are the
// exception so emoji sequences and some scripts work; they are invisible to
// the comparison key anyway.
const FORBIDDEN_CHARACTERS = /[\p{Cc}\p{Co}\p{Zl}\p{Zp}]|(?![‌‍])\p{Cf}/u;
/** Stacked combining marks ("zalgo") beyond two per base character. */
const STACKED_MARKS = /\p{Mn}{3,}/u;
// A scheme, "www." or a host with a common top-level domain ("abc.com",
// "line.me"); initials such as "J.Lo" or "Mr.Smith" stay allowed.
const URL_PATTERNS = [
  /[a-z][a-z0-9+.-]*:\/\//iu,
  /(?:^|[^a-z0-9])www\./iu,
  /[a-z0-9-]\.(?:com|net|org|edu|gov|tw|io|co|me|app|cc|info|biz|xyz|top|shop|site|online|link|ly|gl|gg|tv|hk|cn|jp|us|uk)(?![a-z0-9])/iu,
];

/**
 * The comparison key for "is this name already used": NFKC (full-width →
 * half-width), case-insensitive, every whitespace and format character
 * removed. Used for viewer nicknames, chat author names, scripted role names
 * and the vendor name alike.
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
  if (FORBIDDEN_CHARACTERS.test(normalized) || STACKED_MARKS.test(normalized)) return { ok: false, problem: "invalid_characters" };
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
    path: LIVE_VIEWER_PROFILE_COOKIE_PATH,
    maxAge: LIVE_VIEWER_PROFILE_COOKIE_MAX_AGE_SECONDS,
  };
}

export type LiveViewerProfileView = {
  nickname: string;
  avatarSeed: string;
  avatarUrl: string;
};

type ProfileRow = { id: string; nickname: string; avatarSeed: string; normalizedNickname: string | null; lastActiveAt: Date };

const PROFILE_SELECT = { id: true, nickname: true, avatarSeed: true, normalizedNickname: true, lastActiveAt: true } as const;

function toView(row: Pick<ProfileRow, "nickname" | "avatarSeed"> | null): LiveViewerProfileView | null {
  if (!row) return null;
  const avatarUrl = liveViewerAvatarUrl(row.avatarSeed);
  return avatarUrl ? { nickname: row.nickname, avatarSeed: row.avatarSeed, avatarUrl } : null;
}

type ProfileModels = Pick<PrismaClient, "liveViewerSession" | "liveViewerProfile" | "live" | "$queryRaw">;

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
  const tokenHash = hashLiveViewerToken(input.admissionToken);
  const session = await database.liveViewerSession.findUnique({
    where: { tokenHash },
    select: { vendorId: true, liveId: true, expiresAt: true },
  });
  const now = input.now ?? new Date();
  if (!session || session.vendorId !== input.vendorId || session.liveId !== input.liveId || session.expiresAt <= now) {
    throw new LiveViewerProfileError("access_denied");
  }
  return { vendorId: session.vendorId, liveId: session.liveId, admissionTokenHash: tokenHash };
}

/**
 * The profile row of this cookie in this live, or null. Includes released
 * rows (normalizedNickname NULL); `findActiveLiveViewerProfile` does not.
 */
export async function findLiveViewerProfile(
  database: Pick<PrismaClient, "liveViewerProfile">,
  scope: { vendorId: string; liveId: string },
  profileToken: string | null,
): Promise<ProfileRow | null> {
  if (!isLiveViewerProfileToken(profileToken)) return null;
  return database.liveViewerProfile.findUnique({
    where: {
      vendorId_liveId_viewerKeyHash: {
        vendorId: scope.vendorId,
        liveId: scope.liveId,
        viewerKeyHash: hashLiveViewerProfileKey(profileToken, scope.liveId),
      },
    },
    select: PROFILE_SELECT,
  });
}

/** The profile a chat message may use: this cookie's, still holding its name. */
export async function findActiveLiveViewerProfile(
  database: Pick<PrismaClient, "liveViewerProfile">,
  scope: { vendorId: string; liveId: string },
  profileToken: string | null,
) {
  const row = await findLiveViewerProfile(database, scope, profileToken);
  return row && row.normalizedNickname !== null ? row : null;
}

/** Moves lastActiveAt forward at most once an hour, so reads stay cheap. */
export async function touchLiveViewerProfile(
  database: Pick<PrismaClient, "liveViewerProfile">,
  profile: { id: string; lastActiveAt: Date },
  now: Date,
) {
  if (now.getTime() - profile.lastActiveAt.getTime() < ACTIVITY_REFRESH_MS) return;
  await database.liveViewerProfile.updateMany({
    where: { id: profile.id, lastActiveAt: { lt: new Date(now.getTime() - ACTIVITY_REFRESH_MS) } },
    data: { lastActiveAt: now },
  });
}

/**
 * Names a viewer may not take in this live: the vendor (brand) name, every
 * active role of the live's own interaction script, the default "觀眾", and
 * the registration name of anyone who posted here in the last 7 days without
 * a nickname (except the caller's own registration). Only this vendor's
 * script, roles and messages count.
 */
export async function reservedLiveViewerNicknameKeys(
  database: Pick<PrismaClient, "live" | "$queryRaw">,
  scope: { vendorId: string; liveId: string },
  options: { now?: Date; ownSubmissionId?: string | null } = {},
) {
  const now = options.now ?? new Date();
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
  // Only rows that still show their registration name count: a message whose
  // profile was released keeps viewerProfileId, and one whose profile was
  // deleted carries viewerProfileRemovedAt; both show "觀眾" instead.
  const since = new Date(now.getTime() - LIVE_VIEWER_NICKNAME_HOLD_MS);
  const ownSubmission = options.ownSubmissionId
    ? Prisma.sql`AND ("formSubmissionId" IS NULL OR "formSubmissionId" <> ${options.ownSubmissionId})`
    : Prisma.empty;
  const authors = await database.$queryRaw<Array<{ authorName: string }>>`
    SELECT DISTINCT "authorName"
      FROM "LiveChatMessage"
     WHERE "vendorId" = ${scope.vendorId}
       AND "liveId" = ${scope.liveId}
       AND "source" = 'viewer'
       AND "viewerProfileId" IS NULL
       AND "viewerProfileRemovedAt" IS NULL
       AND "createdAt" >= ${since}
       ${ownSubmission}
     LIMIT ${RECENT_AUTHOR_SCAN_LIMIT}`;
  const names = [
    ...RESERVED_NICKNAMES,
    live.vendor.name,
    ...(live.interactionScript?.vendorId === scope.vendorId
      ? live.interactionScript.events.map((event) => event.role?.name ?? "")
      : []),
    ...authors.map((author) => author.authorName),
  ];
  return new Set(names.map(liveViewerNicknameKey).filter(Boolean));
}

/**
 * The merchant's moderation for this viewer, resolved by the route from the
 * vendor blacklist (identity: verified registration email/phone, IP, admission
 * visitor id; keywords). Kept as a callback so this module does not depend on
 * the chat module.
 */
export type LiveViewerProfileModeration = {
  identityBlocked: boolean;
  isNicknameBlocked: (nickname: string) => boolean;
  /** The caller's own verified registration, if any. */
  ownSubmissionId: string | null;
  /** That registration's name (the nickname suggestion), if any. */
  ownRegistrationName?: string | null;
};

export type ReadLiveViewerProfileResult = {
  /** The admission session's vendor and live; reuse it instead of client ids. */
  scope: { vendorId: string; liveId: string };
  profile: LiveViewerProfileView | null;
  /** A released profile's old name, offered again as the suggestion. */
  previousNickname: string | null;
};

export async function readLiveViewerProfile(
  database: ProfileModels,
  input: { vendorId: string; liveId: string; admissionToken: string | null; profileToken: string | null; now?: Date },
): Promise<ReadLiveViewerProfileResult> {
  const now = input.now ?? new Date();
  const scope = await resolveLiveViewerProfileScope(database, { ...input, now });
  const serverScope = { vendorId: scope.vendorId, liveId: scope.liveId };
  const row = await findLiveViewerProfile(database, scope, input.profileToken);
  if (!row) return { scope: serverScope, profile: null, previousNickname: null };
  if (row.normalizedNickname === null) return { scope: serverScope, profile: null, previousNickname: row.nickname };
  await touchLiveViewerProfile(database, row, now);
  return { scope: serverScope, profile: toView(row), previousNickname: null };
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

async function assertProfileCreationAllowed(
  database: Pick<PrismaClient, "liveViewerProfile">,
  scope: { vendorId: string; liveId: string; admissionTokenHash: string },
  viewerKeyHash: string,
) {
  const existing = await database.liveViewerProfile.findUnique({
    where: { vendorId_liveId_viewerKeyHash: { vendorId: scope.vendorId, liveId: scope.liveId, viewerKeyHash } },
    select: { id: true },
  });
  if (existing) return false;
  const created = await database.liveViewerProfile.count({
    where: { vendorId: scope.vendorId, liveId: scope.liveId, createdBySessionHash: scope.admissionTokenHash },
  });
  if (created >= LIVE_VIEWER_PROFILES_PER_ADMISSION) throw new LiveViewerProfileError("too_many_profiles");
  return true;
}

/**
 * Creates or renames this viewer's profile in one live. Validation, the
 * merchant's moderation and the reserved-name check run first; an idle
 * holder of the same name is released; the (vendorId, liveId,
 * normalizedNickname) unique index then decides races between viewers. Every
 * write is keyed by the admission session's vendorId and liveId.
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
    moderate?: (scope: { vendorId: string; liveId: string }) => Promise<LiveViewerProfileModeration>;
    /** Extra limit on new profiles (per IP and live); true = refused. */
    limitNewProfile?: (scope: { vendorId: string; liveId: string }) => Promise<boolean>;
    now?: Date;
  },
): Promise<SaveLiveViewerProfileResult> {
  const now = input.now ?? new Date();
  const scope = await resolveLiveViewerProfileScope(database, { ...input, now });
  const nickname = normalizeLiveViewerNickname(input.nickname);
  if (!nickname.ok) throw new LiveViewerProfileError("invalid_nickname", nickname.problem);
  const avatarSeed = resolveLiveViewerAvatarSeed(input);
  if (!avatarSeed) throw new LiveViewerProfileError("invalid_avatar");

  const moderation = input.moderate
    ? await input.moderate({ vendorId: scope.vendorId, liveId: scope.liveId })
    : { identityBlocked: false, isNicknameBlocked: () => false, ownSubmissionId: null };
  if (moderation.identityBlocked) throw new LiveViewerProfileError("blocked");
  if (moderation.isNicknameBlocked(nickname.nickname)) throw new LiveViewerProfileError("nickname_blocked");

  const reserved = await reservedLiveViewerNicknameKeys(database, scope, { now, ownSubmissionId: moderation.ownSubmissionId });
  if (reserved.has(nickname.key)) throw new LiveViewerProfileError("nickname_taken");

  const profileToken = isLiveViewerProfileToken(input.profileToken) ? input.profileToken : createLiveViewerProfileToken();
  const issuedProfileToken = profileToken === input.profileToken ? null : profileToken;
  const viewerKeyHash = hashLiveViewerProfileKey(profileToken, scope.liveId);
  const creating = await assertProfileCreationAllowed(database, scope, viewerKeyHash);
  if (creating && input.limitNewProfile && await input.limitNewProfile({ vendorId: scope.vendorId, liveId: scope.liveId })) {
    throw new LiveViewerProfileError("too_many_profiles");
  }

  // An idle holder (7 days) of this name gives it up; its row stays but is
  // no longer shown or reserved. Active holders are left for the unique index.
  await database.liveViewerProfile.updateMany({
    where: {
      vendorId: scope.vendorId,
      liveId: scope.liveId,
      normalizedNickname: nickname.key,
      lastActiveAt: { lt: new Date(now.getTime() - LIVE_VIEWER_NICKNAME_HOLD_MS) },
      NOT: { viewerKeyHash },
    },
    data: { normalizedNickname: null },
  });

  const data = { nickname: nickname.nickname, normalizedNickname: nickname.key, avatarSeed, lastActiveAt: now };
  // The same viewer can race itself (two tabs); the loser of the
  // viewerKeyHash insert retries once as an update.
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const row = await database.liveViewerProfile.upsert({
        where: {
          vendorId_liveId_viewerKeyHash: { vendorId: scope.vendorId, liveId: scope.liveId, viewerKeyHash },
        },
        create: {
          vendorId: scope.vendorId,
          liveId: scope.liveId,
          viewerKeyHash,
          createdBySessionHash: scope.admissionTokenHash,
          ...data,
        },
        update: data,
        select: PROFILE_SELECT,
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
