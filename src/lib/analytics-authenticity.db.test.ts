import { afterEach, describe, expect, it } from "vitest";
import { POST as postAnalytics } from "@/app/api/analytics/route";
import { getDb } from "@/lib/db";
import {
  hashLiveViewerToken,
  LIVE_VIEWER_SESSION_COOKIE,
} from "@/lib/live-quota-admission";

const createdVendorIds: string[] = [];

afterEach(async () => {
  await getDb().vendor.deleteMany({ where: { id: { in: createdVendorIds.splice(0) } } });
});

async function createLiveFixture(suffix: string) {
  const db = getDb();
  const vendor = await db.vendor.create({
    data: {
      name: `G7-13 Analytics authenticity ${suffix}`,
      slug: `g7-13-analytics-${suffix}`,
      email: `g7-13-analytics-${suffix}@example.test`,
      passwordHash: "disposable-test-only",
    },
  });
  createdVendorIds.push(vendor.id);
  const live = await db.live.create({
    data: {
      vendorId: vendor.id,
      title: "Analytics authenticity fixture",
      slug: `g7-13-live-${suffix}`,
      scheduledAt: new Date("2026-08-09T00:00:00.000Z"),
      status: "live",
    },
  });
  return { vendor, live };
}

describe("Analytics authenticity disposable database invariants", () => {
  it("accepts a real active admission cookie and persists only its server-derived session hash", async () => {
    const db = getDb();
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const { vendor, live } = await createLiveFixture(suffix);
    const token = "a".repeat(43);
    const tokenHash = hashLiveViewerToken(token);
    await db.liveViewerSession.create({
      data: {
        vendorId: vendor.id,
        liveId: live.id,
        tokenHash,
        lastSeenAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const response = await postAnalytics(new Request("http://127.0.0.1/api/analytics", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://127.0.0.1",
        "x-celebratedeal-client": "web",
        cookie: `${LIVE_VIEWER_SESSION_COOKIE}=${token}`,
      },
      body: JSON.stringify({
        vendorId: vendor.id,
        liveId: live.id,
        eventType: "page_view",
        payload: { slug: live.slug },
      }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, verified: true });
    await expect(db.analyticsEvent.findFirstOrThrow({ where: { vendorId: vendor.id } })).resolves.toMatchObject({
      liveId: live.id,
      eventType: "page_view",
      visitorId: tokenHash,
      trustLevel: "ADMITTED_LIVE_SESSION",
    });
  });

  it("keeps legacy rows unverified and counts only distinct admitted playback sessions", async () => {
    const db = getDb();
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const { vendor, live } = await createLiveFixture(suffix);

    await db.$executeRaw`
      INSERT INTO "AnalyticsEvent" ("id", "vendorId", "liveId", "eventType", "visitorId", "createdAt")
      VALUES (${`legacy-${suffix}`}, ${vendor.id}, ${live.id}, 'page_view', 'client-controlled-id', NOW())
    `;
    await db.analyticsEvent.createMany({
      data: [
        {
          vendorId: vendor.id,
          liveId: live.id,
          eventType: "page_view",
          visitorId: "server-session-a",
          trustLevel: "ADMITTED_LIVE_SESSION",
        },
        {
          vendorId: vendor.id,
          liveId: live.id,
          eventType: "page_view",
          visitorId: "server-session-a",
          trustLevel: "ADMITTED_LIVE_SESSION",
        },
        {
          vendorId: vendor.id,
          liveId: live.id,
          eventType: "page_view",
          visitorId: "server-session-b",
          trustLevel: "ADMITTED_LIVE_SESSION",
        },
      ],
    });

    const legacy = await db.analyticsEvent.findUniqueOrThrow({ where: { id: `legacy-${suffix}` } });
    expect(legacy.trustLevel).toBe("LEGACY_UNVERIFIED");

    const canonicalSessions = await db.analyticsEvent.findMany({
      where: {
        vendorId: vendor.id,
        liveId: live.id,
        eventType: "page_view",
        trustLevel: "ADMITTED_LIVE_SESSION",
      },
      select: { eventType: true, visitorId: true },
      distinct: ["eventType", "visitorId"],
    });
    expect(canonicalSessions).toHaveLength(2);
    expect(canonicalSessions.map((row) => row.visitorId).sort()).toEqual([
      "server-session-a",
      "server-session-b",
    ]);
  });

  it("rejects unknown trust levels at the database boundary", async () => {
    const db = getDb();
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const { vendor, live } = await createLiveFixture(suffix);

    await expect(db.$executeRaw`
      INSERT INTO "AnalyticsEvent" ("id", "vendorId", "liveId", "eventType", "visitorId", "trustLevel", "createdAt")
      VALUES (${`invalid-${suffix}`}, ${vendor.id}, ${live.id}, 'page_view', 'invalid-session', ${"FORGED_CLIENT_EVENT"}, NOW())
    `).rejects.toThrow();
    expect(await db.analyticsEvent.count({ where: { vendorId: vendor.id } })).toBe(0);
  });
});
