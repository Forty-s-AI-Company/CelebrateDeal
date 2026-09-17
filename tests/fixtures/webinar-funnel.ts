import type { PrismaClient } from "@prisma/client";
import { createLandingPageFixture } from "./landing-page";

/** Synthetic, owned resources created only inside the disposable QA database. */
export async function createWebinarFunnelFixture(db: PrismaClient, runKey: string) {
  const fixture = await createLandingPageFixture(db, runKey);
  const video = await db.video.create({ data: {
    vendorId: fixture.vendor.id,
    title: "TEST ONLY Webinar 來源影片",
    sourceType: "url",
    videoUrl: "https://example.test/test-only-webinar.mp4",
    status: "ready",
    durationSec: 3600,
  } });
  await db.live.update({ where: { id: fixture.live.id }, data: { videoId: video.id } });
  const live = await db.live.findUniqueOrThrow({ where: { id: fixture.live.id }, select: { slug: true } });
  return { ...fixture, live: { ...fixture.live, slug: live.slug }, video: { id: video.id } };
}
