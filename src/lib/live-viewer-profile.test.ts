import { describe, expect, it, vi } from "vitest";
import { interactionRoleAvatarUrl } from "@/lib/interaction-role";
import { hashLiveViewerToken } from "@/lib/live-quota-admission";
import {
  hashLiveViewerProfileKey,
  LIVE_VIEWER_AVATAR_SEEDS,
  LIVE_VIEWER_NICKNAME_TAKEN_MESSAGE,
  LIVE_VIEWER_PROFILE_COOKIE,
  liveViewerAvatarUrl,
  liveViewerNicknameKey,
  liveViewerProfileCookieOptions,
  LiveViewerProfileError,
  liveViewerProfileErrorMessage,
  liveViewerProfileTokenFromRequest,
  normalizeLiveViewerNickname,
  readLiveViewerProfile,
  resolveLiveViewerAvatarSeed,
  saveLiveViewerProfile,
  suggestLiveViewerNickname,
} from "@/lib/live-viewer-profile";

const ADMISSION = "A".repeat(43);
const PROFILE = "P".repeat(43);
const NOW = new Date("2026-11-26T10:00:00.000Z");

describe("normalizeLiveViewerNickname", () => {
  it("applies NFKC, trims and collapses inner spaces", () => {
    expect(normalizeLiveViewerNickname("  Ａｌｉｃｅ　　小明  ")).toEqual({ ok: true, nickname: "Alice 小明", key: "alice小明" });
  });

  it("compares ignoring case, full/half width and every whitespace", () => {
    const keys = ["Alice", "ALICE", "ａｌｉｃｅ", "A l i c e", "Ａ ＬＩＣＥ"].map(liveViewerNicknameKey);
    expect(new Set(keys)).toEqual(new Set(["alice"]));
    expect(liveViewerNicknameKey("小 明")).toBe(liveViewerNicknameKey("小明"));
  });

  it("requires 1 to 20 characters counted as code points", () => {
    expect(normalizeLiveViewerNickname("")).toEqual({ ok: false, problem: "empty" });
    expect(normalizeLiveViewerNickname("　 　")).toEqual({ ok: false, problem: "empty" });
    expect(normalizeLiveViewerNickname("一".repeat(20))).toMatchObject({ ok: true });
    expect(normalizeLiveViewerNickname("一".repeat(21))).toEqual({ ok: false, problem: "too_long" });
    expect(normalizeLiveViewerNickname("😀".repeat(20))).toMatchObject({ ok: true });
    expect(normalizeLiveViewerNickname("x".repeat(201))).toEqual({ ok: false, problem: "too_long" });
    expect(normalizeLiveViewerNickname(42)).toEqual({ ok: false, problem: "empty" });
  });

  it("rejects control, zero-width and bidi characters", () => {
    for (const value of ["a\u0000b", "a\nb", "a\tb", "a​b", "a‮b", "a b", "﻿name"]) {
      expect(normalizeLiveViewerNickname(value)).toEqual({ ok: false, problem: "invalid_characters" });
    }
  });

  it("rejects links but keeps initials", () => {
    for (const value of ["https://x.test", "看 www.abc", "abc.com", "加我 line.me", "shop.tw", "ftp://a"]) {
      expect(normalizeLiveViewerNickname(value)).toEqual({ ok: false, problem: "contains_url" });
    }
    for (const value of ["J.Lo", "Mr.Smith", "小明.", "A. B"]) {
      expect(normalizeLiveViewerNickname(value)).toMatchObject({ ok: true });
    }
  });
});

describe("avatar presets", () => {
  it("accepts only the 20 preset seeds or their canonical URLs", () => {
    expect(LIVE_VIEWER_AVATAR_SEEDS).toHaveLength(20);
    expect(resolveLiveViewerAvatarSeed({ avatarSeed: "host-blue" })).toBe("host-blue");
    expect(resolveLiveViewerAvatarSeed({ avatarUrl: interactionRoleAvatarUrl("chat-mint") })).toBe("chat-mint");
    expect(resolveLiveViewerAvatarSeed({ avatarSeed: "evil" })).toBeNull();
    expect(resolveLiveViewerAvatarSeed({ avatarUrl: "https://evil.example/a.png" })).toBeNull();
    expect(resolveLiveViewerAvatarSeed({ avatarUrl: `${interactionRoleAvatarUrl("chat-mint")}&x=1` })).toBeNull();
    // An explicit seed wins; a bad seed is not rescued by a good URL.
    expect(resolveLiveViewerAvatarSeed({ avatarSeed: "evil", avatarUrl: interactionRoleAvatarUrl("chat-mint") })).toBeNull();
    expect(resolveLiveViewerAvatarSeed({})).toBeNull();
  });

  it("projects only preset seeds to URLs", () => {
    expect(liveViewerAvatarUrl("host-blue")).toBe(interactionRoleAvatarUrl("host-blue"));
    expect(liveViewerAvatarUrl("not-a-preset")).toBeNull();
    expect(liveViewerAvatarUrl(null)).toBeNull();
  });
});

describe("nickname suggestion and messages", () => {
  it("suggests the registration name cut to the limit, or nothing when invalid", () => {
    expect(suggestLiveViewerNickname("  王小明 ")).toBe("王小明");
    expect(suggestLiveViewerNickname("一".repeat(30))).toBe("一".repeat(20));
    expect(suggestLiveViewerNickname("me@shop.com")).toBeNull();
    expect(suggestLiveViewerNickname(null)).toBeNull();
  });

  it("explains each refusal in Traditional Chinese", () => {
    expect(liveViewerProfileErrorMessage(new LiveViewerProfileError("nickname_taken"))).toBe("這個名稱已經有人使用，請換一個");
    expect(LIVE_VIEWER_NICKNAME_TAKEN_MESSAGE).toBe("這個名稱已經有人使用，請換一個");
    expect(liveViewerProfileErrorMessage(new LiveViewerProfileError("invalid_nickname", "too_long"))).toContain("20");
    expect(liveViewerProfileErrorMessage(new LiveViewerProfileError("invalid_nickname", "contains_url"))).toContain("網址");
    expect(liveViewerProfileErrorMessage(new LiveViewerProfileError("invalid_nickname", "empty"))).toContain("請輸入");
    expect(liveViewerProfileErrorMessage(new LiveViewerProfileError("invalid_nickname", "invalid_characters"))).toContain("字元");
    expect(liveViewerProfileErrorMessage(new LiveViewerProfileError("invalid_avatar"))).toContain("頭像");
    expect(liveViewerProfileErrorMessage(new LiveViewerProfileError("access_denied"))).toContain("重新進入");
  });
});

describe("profile cookie", () => {
  it("reads one well-formed cookie and refuses duplicates or junk", () => {
    const request = (cookie: string) => new Request("https://app.example.test/x", { headers: { cookie } });
    expect(liveViewerProfileTokenFromRequest(request(`${LIVE_VIEWER_PROFILE_COOKIE}=${PROFILE}`))).toBe(PROFILE);
    expect(liveViewerProfileTokenFromRequest(request(`${LIVE_VIEWER_PROFILE_COOKIE}=${PROFILE}; ${LIVE_VIEWER_PROFILE_COOKIE}=${PROFILE}`))).toBeNull();
    expect(liveViewerProfileTokenFromRequest(request(`${LIVE_VIEWER_PROFILE_COOKIE}=short`))).toBeNull();
    expect(liveViewerProfileTokenFromRequest(new Request("https://app.example.test/x"))).toBeNull();
  });

  it("is HttpOnly, Lax and secure on https", () => {
    expect(liveViewerProfileCookieOptions(new Request("https://app.example.test/x"))).toMatchObject({ httpOnly: true, sameSite: "lax", secure: true, path: "/" });
    expect(liveViewerProfileCookieOptions(new Request("http://127.0.0.1:3000/x")).secure).toBe(false);
  });

  it("hashes per live so one cookie cannot link two lives", () => {
    expect(hashLiveViewerProfileKey(PROFILE, "live-1")).toMatch(/^[0-9a-f]{64}$/u);
    expect(hashLiveViewerProfileKey(PROFILE, "live-1")).not.toBe(hashLiveViewerProfileKey(PROFILE, "live-2"));
  });
});

function fakeDatabase(options: {
  session?: { vendorId: string; liveId: string; expiresAt: Date } | null;
  live?: unknown;
  upsert?: () => Promise<unknown>;
  profile?: unknown;
} = {}) {
  return {
    liveViewerSession: {
      findUnique: vi.fn(async () => options.session === undefined
        ? { vendorId: "vendor-1", liveId: "live-1", expiresAt: new Date(NOW.getTime() + 60_000) }
        : options.session),
    },
    live: {
      findFirst: vi.fn(async () => options.live === undefined
        ? { vendor: { name: "幸福烘焙" }, interactionScript: { vendorId: "vendor-1", events: [{ role: { name: "小助理 Amy" } }, { role: null }] } }
        : options.live),
    },
    liveViewerProfile: {
      findUnique: vi.fn(async () => options.profile ?? null),
      upsert: vi.fn(options.upsert ?? (async () => ({ id: "profile-1", nickname: "小明", avatarSeed: "host-blue" }))),
    },
  };
}

const saveInput = {
  vendorId: "vendor-1",
  liveId: "live-1",
  admissionToken: ADMISSION,
  profileToken: null as string | null,
  nickname: "小明",
  avatarSeed: "host-blue",
  now: NOW,
};

describe("saveLiveViewerProfile", () => {
  it("binds the write to the admission session's vendor and live and issues a cookie once", async () => {
    const database = fakeDatabase();
    const result = await saveLiveViewerProfile(database as never, saveInput);

    expect(database.liveViewerSession.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { tokenHash: hashLiveViewerToken(ADMISSION) } }));
    expect(database.live.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "live-1", vendorId: "vendor-1" } }));
    const upsert = database.liveViewerProfile.upsert.mock.calls[0] as unknown as [{ where: unknown; create: Record<string, unknown> }];
    expect(upsert[0].create).toMatchObject({ vendorId: "vendor-1", liveId: "live-1", nickname: "小明", normalizedNickname: "小明", avatarSeed: "host-blue" });
    expect(result.issuedProfileToken).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(upsert[0].create.viewerKeyHash).toBe(hashLiveViewerProfileKey(result.issuedProfileToken!, "live-1"));
    expect(result.profile).toEqual({ nickname: "小明", avatarSeed: "host-blue", avatarUrl: interactionRoleAvatarUrl("host-blue") });

    const again = await saveLiveViewerProfile(database as never, { ...saveInput, profileToken: PROFILE });
    expect(again.issuedProfileToken).toBeNull();
  });

  it("refuses without an active admission for exactly this vendor and live", async () => {
    const cases = [
      { admissionToken: null },
      { admissionToken: "bad" },
      { session: null },
      { session: { vendorId: "vendor-1", liveId: "live-2", expiresAt: new Date(NOW.getTime() + 60_000) } },
      { session: { vendorId: "vendor-2", liveId: "live-1", expiresAt: new Date(NOW.getTime() + 60_000) } },
      { session: { vendorId: "vendor-1", liveId: "live-1", expiresAt: NOW } },
    ];
    for (const item of cases) {
      const database = fakeDatabase("session" in item ? { session: item.session } : {});
      await expect(saveLiveViewerProfile(database as never, { ...saveInput, ...("admissionToken" in item ? { admissionToken: item.admissionToken } : {}) }))
        .rejects.toMatchObject({ code: "access_denied" });
      expect(database.liveViewerProfile.upsert).not.toHaveBeenCalled();
    }
  });

  it("refuses the vendor name, an active script role and the default name in any case or width", async () => {
    for (const nickname of ["幸福烘焙", "幸 福 烘 焙", "小助理amy", "小助理ＡＭＹ", "觀眾"]) {
      const database = fakeDatabase();
      await expect(saveLiveViewerProfile(database as never, { ...saveInput, nickname })).rejects.toMatchObject({ code: "nickname_taken" });
      expect(database.liveViewerProfile.upsert).not.toHaveBeenCalled();
    }
  });

  it("asks only for this vendor's active roles and ignores another vendor's script", async () => {
    const database = fakeDatabase({ live: { vendor: { name: "幸福烘焙" }, interactionScript: { vendorId: "vendor-2", events: [{ role: { name: "小明" } }] } } });
    await expect(saveLiveViewerProfile(database as never, saveInput)).resolves.toMatchObject({ profile: { nickname: "小明" } });
    const query = database.live.findFirst.mock.calls[0] as unknown as [{ select: { interactionScript: { select: { events: { where: unknown } } } } }];
    expect(query[0].select.interactionScript.select.events.where).toEqual({ role: { is: { vendorId: "vendor-1", isActive: true } } });
  });

  it("validates the nickname and avatar before any write", async () => {
    const database = fakeDatabase();
    await expect(saveLiveViewerProfile(database as never, { ...saveInput, nickname: " " })).rejects.toMatchObject({ code: "invalid_nickname", problem: "empty" });
    await expect(saveLiveViewerProfile(database as never, { ...saveInput, avatarSeed: "https://evil.example/a.png" })).rejects.toMatchObject({ code: "invalid_avatar" });
    expect(database.liveViewerProfile.upsert).not.toHaveBeenCalled();
  });

  it("maps a unique clash on the nickname to taken and retries a same-viewer race once", async () => {
    const taken = Object.assign(new Error("unique"), { code: "P2002", meta: { target: ["vendorId", "liveId", "normalizedNickname"] } });
    await expect(saveLiveViewerProfile(fakeDatabase({ upsert: async () => { throw taken; } }) as never, saveInput))
      .rejects.toMatchObject({ name: "LiveViewerProfileError", code: "nickname_taken" });

    let calls = 0;
    const raced = Object.assign(new Error("unique"), { code: "P2002", meta: { target: "LiveViewerProfile_vendorId_liveId_viewerKeyHash_key" } });
    const database = fakeDatabase({
      upsert: async () => {
        calls += 1;
        if (calls === 1) throw raced;
        return { id: "profile-1", nickname: "小明", avatarSeed: "host-blue" };
      },
    });
    await expect(saveLiveViewerProfile(database as never, saveInput)).resolves.toMatchObject({ profile: { nickname: "小明" } });
    expect(calls).toBe(2);

    await expect(saveLiveViewerProfile(fakeDatabase({ upsert: async () => { throw raced; } }) as never, saveInput))
      .rejects.toMatchObject({ code: "nickname_taken" });
    await expect(saveLiveViewerProfile(fakeDatabase({ upsert: async () => { throw new Error("db down"); } }) as never, saveInput))
      .rejects.toThrow("db down");
  });
});

describe("readLiveViewerProfile", () => {
  it("returns this cookie's profile in this live only", async () => {
    const database = fakeDatabase({ profile: { id: "profile-1", nickname: "小明", avatarSeed: "care-teal" } });
    await expect(readLiveViewerProfile(database as never, { ...saveInput, profileToken: PROFILE }))
      .resolves.toEqual({ nickname: "小明", avatarSeed: "care-teal", avatarUrl: interactionRoleAvatarUrl("care-teal") });
    expect(database.liveViewerProfile.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { vendorId_liveId_viewerKeyHash: { vendorId: "vendor-1", liveId: "live-1", viewerKeyHash: hashLiveViewerProfileKey(PROFILE, "live-1") } },
    }));
    const noCookie = fakeDatabase();
    await expect(readLiveViewerProfile(noCookie as never, saveInput)).resolves.toBeNull();
    expect(noCookie.liveViewerProfile.findUnique).not.toHaveBeenCalled();
  });
});
