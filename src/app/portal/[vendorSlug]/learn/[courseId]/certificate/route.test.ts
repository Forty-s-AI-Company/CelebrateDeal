import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ session: vi.fn(), details: vi.fn(), certificate: vi.fn(), db: {} }));

vi.mock("@/lib/student-portal-auth", () => ({ requireStudentPortalSession: mocks.session }));
vi.mock("@/lib/student-course-learning", () => ({ studentCertificateDetails: mocks.details }));
vi.mock("@/lib/course-certificate", () => ({ createCourseCertificate: mocks.certificate }));
vi.mock("@/lib/db", () => ({ getDb: () => mocks.db }));

import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ session: { vendorId: "vendor-1", customerKeyHash: "learner-hash" } });
  mocks.details.mockResolvedValue({ title: "成交實戰課", completedAt: "2026-09-09T00:00:00.000Z" });
  mocks.certificate.mockReturnValue({ svg: "<svg xmlns=\"http://www.w3.org/2000/svg\" />" });
});

describe("student course certificate route", () => {
  it("renders a no-store SVG only from the authenticated tenant-student course scope", async () => {
    const response = await GET(new Request("https://app.example.test/portal/teacher/learn/course-1/certificate"), {
      params: Promise.resolve({ vendorSlug: "teacher", courseId: "course-1" }),
    });

    expect(mocks.session).toHaveBeenCalledWith("teacher");
    expect(mocks.details).toHaveBeenCalledWith(mocks.db, { vendorId: "vendor-1", customerKeyHash: "learner-hash" }, "course-1");
    expect(mocks.certificate).toHaveBeenCalledWith(expect.objectContaining({ customerKeyHash: "learner-hash", courseId: "course-1" }));
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-type")).toBe("image/svg+xml; charset=utf-8");
    await expect(response.text()).resolves.toContain("<svg");
  });

  it("returns a non-cacheable 404 when the scoped course is unavailable", async () => {
    mocks.details.mockResolvedValue(null);

    const response = await GET(new Request("https://app.example.test/portal/teacher/learn/course-1/certificate"), {
      params: Promise.resolve({ vendorSlug: "teacher", courseId: "course-1" }),
    });

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.certificate).not.toHaveBeenCalled();
  });

  it.each([181, 200])("downloads a real SVG for a %i character product name", async (length) => {
    const actual = await vi.importActual<typeof import("@/lib/course-certificate")>("@/lib/course-certificate");
    mocks.certificate.mockImplementation(actual.createCourseCertificate);
    const courseName = "課".repeat(length);
    mocks.details.mockResolvedValue({ vendorName: "學院", studentName: "學員", courseName, completedAt: new Date("2026-09-09Z") });
    const response = await GET(new Request("https://app.example.test/portal/teacher/learn/course-1/certificate"), { params: Promise.resolve({ vendorSlug: "teacher", courseId: "course-1" }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("image/svg+xml");
    const svg = await response.text();
    expect([...svg.matchAll(/<tspan x="800" dy="\d+">([^<]+)<\/tspan>/gu)].map((match) => match[1]).join("")).toBe(courseName);
  });
});
