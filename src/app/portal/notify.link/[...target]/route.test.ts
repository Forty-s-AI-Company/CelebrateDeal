import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ vendor: vi.fn(), live: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ vendor: { findUnique: mocks.vendor }, live: { findFirst: mocks.live } }) }));
vi.mock("@/lib/app-url", () => ({ getCanonicalAppUrl: () => "https://app.example.test" }));
import { GET } from "./route";
import { learnerNotificationLink, parseLearnerNotificationLink } from "@/lib/learner-notification-links";

const cjkSlug = "課".repeat(80);
const open = async (path: string) => {
  const target = path.replace(/^\/portal\/notify\.link\//u, "").split("/");
  const response = await GET(new Request(`https://untrusted-host.example${path}`), { params: Promise.resolve({ target }) });
  return { status: response.status, location: response.headers.get("location"), cache: response.headers.get("cache-control") };
};
beforeEach(() => { vi.clearAllMocks(); mocks.vendor.mockResolvedValue({ slug: cjkSlug }); mocks.live.mockResolvedValue({ slug: "直播".repeat(40) }); });

it("stored links stay short and vendor-independent even for an 80-character CJK slug", () => {
  const links = [learnerNotificationLink.notifications("vendor_a"), learnerNotificationLink.course("vendor_a", "course_a"), learnerNotificationLink.certificate("vendor_a", "course_a"),
    learnerNotificationLink.community("vendor_a", "course_a", "cm_post"), learnerNotificationLink.live("vendor_a", "live_a")];
  for (const link of links) { expect(link.length).toBeLessThanOrEqual(512); expect(link).toMatch(/^\/(?!\/)[A-Za-z0-9_/%.-]+$/u); expect(link).not.toContain("%"); }
  const longest = learnerNotificationLink.community("v".repeat(128), "c".repeat(128), "p".repeat(128));
  expect(longest.length).toBeLessThanOrEqual(512);
  expect(() => learnerNotificationLink.course("vendor_a", "../course")).toThrow();
  expect(() => learnerNotificationLink.community("vendor_a", "course_a", "data")).toThrow();
});

it.each([
  ["/portal/notify.link/vendor_a/notifications", `/portal/${encodeURIComponent(cjkSlug)}/notifications`],
  ["/portal/notify.link/vendor_a/learn/course_a", `/portal/${encodeURIComponent(cjkSlug)}/learn/course_a`],
  ["/portal/notify.link/vendor_a/learn/course_a/certificate", `/portal/${encodeURIComponent(cjkSlug)}/learn/course_a/certificate`],
  ["/portal/notify.link/vendor_a/learn/course_a/community/cm_post", `/portal/${encodeURIComponent(cjkSlug)}/learn/course_a/community/cm_post`],
])("resolves %s to the tenant's current portal URL on the canonical origin", async (path, expected) => {
  const result = await open(path);
  expect(result.status).toBe(303); expect(result.location).toBe(`https://app.example.test${expected}`); expect(result.cache).toBe("private, no-store");
  expect(mocks.vendor).toHaveBeenCalledWith({ where: { id: "vendor_a" }, select: { slug: true } });
});

it("resolves a live link through the owning tenant and a non-draft status only", async () => {
  const result = await open("/portal/notify.link/vendor_a/live/live_a");
  expect(result.location).toBe(`https://app.example.test/live/${encodeURIComponent("直播".repeat(40))}`);
  expect(mocks.live).toHaveBeenCalledWith({ where: { id: "live_a", vendorId: "vendor_a", status: { in: ["scheduled", "live", "ended"] } }, select: { slug: true } });
  mocks.live.mockResolvedValue(null);
  expect((await open("/portal/notify.link/vendor_a/live/live_a")).location).toBe(`https://app.example.test/portal/${encodeURIComponent(cjkSlug)}`);
});

it.each(["/portal/notify.link/vendor_a", "/portal/notify.link/vendor_a/learn/course_a/community/data", "/portal/notify.link/vendor_a/notifications/enroll",
  "/portal/notify.link/vendor_a/learn/course_a/notifications", "/portal/notify.link/..%2Fvendor/notifications", "/portal/notify.link/vendor_a/admin"])("unknown or unsafe target %s falls back to the public portal entry", async path => {
  const result = await open(path);
  expect(result.location).toBe("https://app.example.test/portal/start.html");
});

it("missing vendor or a database failure falls back without detail", async () => {
  mocks.vendor.mockResolvedValueOnce(null);
  expect((await open("/portal/notify.link/vendor_a/notifications")).location).toBe("https://app.example.test/portal/start.html");
  mocks.vendor.mockRejectedValueOnce(new Error("private"));
  expect((await open("/portal/notify.link/vendor_a/notifications")).location).toBe("https://app.example.test/portal/start.html");
});

it("parser accepts only the produced shapes", () => {
  expect(parseLearnerNotificationLink(["vendor_a", "notifications"])).toEqual({ vendorId: "vendor_a", kind: "notifications" });
  expect(parseLearnerNotificationLink(undefined)).toBeNull();
  expect(parseLearnerNotificationLink(["vendor_a", "learn", "course_a", "certificate", "extra"])).toBeNull();
});
