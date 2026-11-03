import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "../src/lib/db";
import { decryptMfaSecret, encryptMfaSecret, generateTotpSecret, mfaSecretKeyId } from "../src/lib/mfa";
import { protectLineOfficialAccountCredentials, unprotectLineOfficialAccountCredentials } from "../src/lib/line-credentials";
import { decryptSensitiveValue, encryptSensitiveValue, sensitiveEnvelopeKeyId } from "../src/lib/sensitive-data";
import { protectFacebookAccessToken, unprotectFacebookAccessToken } from "../src/lib/tracking-credentials";
import { CLOUDFLARE_STREAM_KEY_PURPOSE } from "../src/lib/cloudflare-ops";
import {
  APPLY_CONFIRMATION,
  SensitiveDataReencryptRefusedError,
  runSensitiveDataReencryption,
  type RawDb,
  type ReencryptOptions,
} from "./reencrypt-sensitive-data";

// Synthetic values only, built at run time (no key- or token-shaped literals).
const keyringKey = (fill: number) => Buffer.alloc(32, fill).toString("base64url");
const KEY_A = keyringKey(41);
const KEY_B = keyringKey(42);
const ROOT = "synthetic-data-reencrypt-root-" + "0123456789abcdef";
const confirmed = { DATA_REENCRYPT_CONFIRM: APPLY_CONFIRMATION };
const dryRun: ReencryptOptions = { apply: false, target: null, batchSize: 2, allowUnreadable: false, only: null };
const apply: ReencryptOptions = { ...dryRun, apply: true };

const vendorIds: string[] = [];
const userIds: string[] = [];

function useKeyring(entries: Array<{ kid: string; key?: string; active?: boolean }> | null) {
  vi.stubEnv("DATA_ENCRYPTION_KEYRING", entries === null ? "" : JSON.stringify(entries));
}

async function seed() {
  const db = getDb();
  const suffix = randomUUID();
  const vendor = await db.vendor.create({
    data: { name: "Synthetic reencrypt", slug: `reencrypt-${suffix}`, email: `reencrypt-${suffix}@example.test`, passwordHash: "synthetic-only" },
  });
  vendorIds.push(vendor.id);
  const user = await db.user.create({ data: { email: `reencrypt-${suffix}@example.test`, name: "Synthetic reencrypt", passwordHash: "synthetic-only" } });
  userIds.push(user.id);

  const plain = {
    facebookToken: `synthetic${randomBytes(12).toString("hex")}`,
    line: {
      messagingChannelId: `channel-${suffix}`,
      messagingChannelSecret: `channel-secret-${suffix}`,
      messagingAccessToken: `access-${suffix}`,
      loginChannelId: null,
      loginChannelSecret: null,
    },
    streamKeys: [`stream-a-${suffix}`, `stream-b-${suffix}`, `stream-c-${suffix}`],
    totp: generateTotpSecret(),
  };
  await db.trackingSetting.create({ data: { vendorId: vendor.id, facebookAccessTokenEncrypted: protectFacebookAccessToken(vendor.id, plain.facebookToken) } });
  await db.lineOfficialAccount.create({ data: { vendorId: vendor.id, ...protectLineOfficialAccountCredentials(vendor.id, plain.line) } });
  const videoIds: string[] = [];
  for (const streamKey of plain.streamKeys) {
    const video = await db.video.create({
      data: { vendorId: vendor.id, title: "Synthetic", videoUrl: "https://video.example.test/x.m3u8", liveStreamKey: encryptSensitiveValue(streamKey, CLOUDFLARE_STREAM_KEY_PURPOSE) },
    });
    videoIds.push(video.id);
  }
  // A non-envelope value is reported as unrecognized and never touched.
  const plaintextVideo = await db.video.create({
    data: { vendorId: vendor.id, title: "Synthetic", videoUrl: "https://video.example.test/y.m3u8", liveStreamKey: "not-an-envelope" },
  });
  await db.userMfaFactor.create({ data: { userId: user.id, factorType: "totp", secretEncrypted: encryptMfaSecret(plain.totp) } });
  return { vendorId: vendor.id, userId: user.id, plain, videoIds, plaintextVideoId: plaintextVideo.id };
}

async function snapshot(fixture: Awaited<ReturnType<typeof seed>>) {
  const db = getDb();
  return {
    tracking: (await db.trackingSetting.findUniqueOrThrow({ where: { vendorId: fixture.vendorId } })).facebookAccessTokenEncrypted!,
    line: await db.lineOfficialAccount.findUniqueOrThrow({
      where: { vendorId: fixture.vendorId },
      select: { messagingChannelIdEncrypted: true, messagingChannelSecretEncrypted: true, messagingAccessTokenEncrypted: true, loginChannelIdEncrypted: true, loginChannelSecretEncrypted: true, updatedAt: true },
    }),
    videos: (await db.video.findMany({ where: { vendorId: fixture.vendorId }, orderBy: { id: "asc" }, select: { id: true, liveStreamKey: true } })),
    mfa: (await db.userMfaFactor.findUniqueOrThrow({ where: { userId: fixture.userId } })).secretEncrypted,
  };
}

function expectReadable(fixture: Awaited<ReturnType<typeof seed>>, state: Awaited<ReturnType<typeof snapshot>>) {
  expect(unprotectFacebookAccessToken(fixture.vendorId, state.tracking)).toBe(fixture.plain.facebookToken);
  const { updatedAt: _updatedAt, ...line } = state.line;
  void _updatedAt;
  expect(unprotectLineOfficialAccountCredentials(fixture.vendorId, line)).toEqual(fixture.plain.line);
  const byId = new Map(state.videos.map((video) => [video.id, video.liveStreamKey]));
  fixture.videoIds.forEach((id, index) => expect(decryptSensitiveValue(byId.get(id)!, CLOUDFLARE_STREAM_KEY_PURPOSE)).toBe(fixture.plain.streamKeys[index]));
  expect(byId.get(fixture.plaintextVideoId)).toBe("not-an-envelope");
  expect(decryptMfaSecret(state.mfa)).toBe(fixture.plain.totp);
}

function keyIds(state: Awaited<ReturnType<typeof snapshot>>) {
  return [
    sensitiveEnvelopeKeyId(state.tracking),
    sensitiveEnvelopeKeyId(state.line.messagingChannelIdEncrypted),
    sensitiveEnvelopeKeyId(state.line.messagingChannelSecretEncrypted),
    sensitiveEnvelopeKeyId(state.line.messagingAccessTokenEncrypted),
    ...state.videos.map((video) => sensitiveEnvelopeKeyId(video.liveStreamKey!)).filter((kid) => kid !== null),
    mfaSecretKeyId(state.mfa),
  ];
}

beforeEach(() => {
  vi.stubEnv("CSRF_SECRET", ROOT);
  vi.stubEnv("JOB_SECRET", "");
  useKeyring(null);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await getDb().vendor.deleteMany({ where: { id: { in: vendorIds.splice(0) } } });
  await getDb().user.deleteMany({ where: { id: { in: userIds.splice(0) } } });
});

describe("scripts/reencrypt-sensitive-data (PostgreSQL)", () => {
  it("dry-runs without writing, then moves every legacy envelope to the active kid idempotently", async () => {
    const fixture = await seed();
    const scope = { vendorIds: [fixture.vendorId], userIds: [fixture.userId] };
    const initial = await snapshot(fixture);
    useKeyring([{ kid: "k2026a", key: KEY_A, active: true }, { kid: "legacy" }]);

    const logs: Array<Record<string, unknown>> = [];
    const plan = await runSensitiveDataReencryption(getDb(), dryRun, {}, { scope, log: (entry) => logs.push(entry) });
    expect(plan).toMatchObject({ mode: "plan", activeKeyId: "k2026a", rows: 9, pending: 8, unreadable: 0, unrecognized: 1 });
    expect(plan.targets.find((target) => target.table === "Video")).toMatchObject({ rows: 4, byKeyId: { legacy: 3 }, pending: 3, unrecognized: 1 });
    expect(await snapshot(fixture)).toEqual(initial);

    await expect(runSensitiveDataReencryption(getDb(), apply, {}, { scope })).rejects.toMatchObject({ category: "confirmation-missing" });
    expect(await snapshot(fixture)).toEqual(initial);

    const first = await runSensitiveDataReencryption(getDb(), apply, confirmed, { scope, log: (entry) => logs.push(entry) });
    expect(first).toMatchObject({ mode: "apply", activeKeyId: "k2026a", reencrypted: 8, changed: 0, remainingPending: 0, remainingUnreadable: 0 });
    const moved = await snapshot(fixture);
    expect(keyIds(moved).every((kid) => kid === "k2026a")).toBe(true);
    expectReadable(fixture, moved);
    // Raw compare-and-swap writes leave updatedAt alone.
    expect(moved.line.updatedAt).toEqual(initial.line.updatedAt);

    // Each batch names its table and the kids before and after.
    const videoBatches = logs.filter((entry) => entry.event === "batch" && entry.table === "Video");
    expect(videoBatches).toHaveLength(2);
    expect(videoBatches[0]).toMatchObject({ column: "liveStreamKey", batch: 1, rows: 2 });
    expect(videoBatches.reduce((sum, entry) => sum + Number(entry.reencrypted), 0)).toBe(3);
    expect(logs.find((entry) => entry.event === "batch" && entry.table === "TrackingSetting"))
      .toMatchObject({ before: { legacy: 1 }, after: { k2026a: 1 }, reencrypted: 1 });
    // Logs carry counts and kids only.
    const serialized = JSON.stringify(logs);
    for (const secret of [fixture.plain.facebookToken, fixture.plain.totp, ...fixture.plain.streamKeys, fixture.plain.line.messagingAccessToken,
      KEY_A, initial.tracking, moved.tracking, fixture.vendorId, fixture.userId, ...fixture.videoIds]) {
      expect(serialized).not.toContain(secret);
    }

    const second = await runSensitiveDataReencryption(getDb(), apply, confirmed, { scope });
    expect(second).toMatchObject({ reencrypted: 0, changed: 0, remainingPending: 0 });
    expect(await snapshot(fixture)).toEqual(moved);
  });

  it("rotates k2026a to k2026b and keeps data readable after the old kid and legacy are removed", async () => {
    const fixture = await seed();
    const scope = { vendorIds: [fixture.vendorId], userIds: [fixture.userId] };
    useKeyring([{ kid: "k2026a", key: KEY_A, active: true }, { kid: "legacy" }]);
    await runSensitiveDataReencryption(getDb(), apply, confirmed, { scope });

    useKeyring([{ kid: "k2026b", key: KEY_B, active: true }, { kid: "k2026a", key: KEY_A }, { kid: "legacy" }]);
    const plan = await runSensitiveDataReencryption(getDb(), dryRun, {}, { scope });
    expect(plan).toMatchObject({ pending: 8, unreadable: 0 });
    const outcome = await runSensitiveDataReencryption(getDb(), apply, confirmed, { scope });
    expect(outcome).toMatchObject({ reencrypted: 8, remainingPending: 0 });

    useKeyring([{ kid: "k2026b", key: KEY_B, active: true }]);
    const final = await snapshot(fixture);
    expect(keyIds(final).every((kid) => kid === "k2026b")).toBe(true);
    expectReadable(fixture, final);
  });

  it("reports rows it cannot open, refuses --apply because of them, and never writes them", async () => {
    const fixture = await seed();
    const scope = { vendorIds: [fixture.vendorId], userIds: [fixture.userId] };
    const wrongPurpose = encryptSensitiveValue("stream", "some-other-purpose");
    await getDb().video.update({ where: { id: fixture.videoIds[0] }, data: { liveStreamKey: wrongPurpose } });
    useKeyring([{ kid: "k2026a", key: KEY_A, active: true }, { kid: "legacy" }]);

    const plan = await runSensitiveDataReencryption(getDb(), { ...dryRun, only: ["Video.liveStreamKey"] }, {}, { scope });
    expect(plan).toMatchObject({ rows: 4, pending: 2, unreadable: 1, unrecognized: 1 });
    await expect(runSensitiveDataReencryption(getDb(), { ...apply, only: ["Video.liveStreamKey"] }, confirmed, { scope }))
      .rejects.toBeInstanceOf(SensitiveDataReencryptRefusedError);

    const outcome = await runSensitiveDataReencryption(getDb(), { ...apply, allowUnreadable: true, only: ["Video.liveStreamKey"] }, confirmed, { scope });
    expect(outcome).toMatchObject({ reencrypted: 2, remainingPending: 0, remainingUnreadable: 1 });
    const stored = await getDb().video.findUniqueOrThrow({ where: { id: fixture.videoIds[0] } });
    expect(stored.liveStreamKey).toBe(wrongPurpose);
  });

  it("counts a row changed underneath the run and leaves the concurrent value in place", async () => {
    const fixture = await seed();
    const scope = { vendorIds: [fixture.vendorId], userIds: [] };
    useKeyring([{ kid: "k2026a", key: KEY_A, active: true }, { kid: "legacy" }]);
    const concurrent = protectFacebookAccessToken(fixture.vendorId, `synthetic${randomBytes(12).toString("hex")}`);
    const db = getDb();
    let interfered = false;
    const racing: RawDb = {
      $queryRawUnsafe: db.$queryRawUnsafe.bind(db),
      $executeRawUnsafe: (async (sql: string, ...values: unknown[]) => {
        if (!interfered && sql.startsWith(`UPDATE "TrackingSetting"`)) {
          interfered = true;
          await db.trackingSetting.update({ where: { vendorId: fixture.vendorId }, data: { facebookAccessTokenEncrypted: concurrent } });
        }
        return db.$executeRawUnsafe(sql, ...values);
      }) as RawDb["$executeRawUnsafe"],
    };

    const outcome = await runSensitiveDataReencryption(racing, { ...apply, only: ["TrackingSetting.facebookAccessTokenEncrypted"] }, confirmed, { scope });
    // The application wrote under the active kid meanwhile, so nothing is left.
    expect(outcome).toMatchObject({ reencrypted: 0, changed: 1, remainingPending: 0 });
    expect(sensitiveEnvelopeKeyId(concurrent)).toBe("k2026a");
    expect((await db.trackingSetting.findUniqueOrThrow({ where: { vendorId: fixture.vendorId } })).facebookAccessTokenEncrypted).toBe(concurrent);
  });
});
