import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ boundary: vi.fn(), readJson: vi.fn(), csrf: vi.fn(), session: vi.fn(), save: vi.fn(), db: {} }));
vi.mock("@/lib/api-security", () => ({ requireSameOriginRequest: mocks.boundary, readJsonBody: mocks.readJson }));
vi.mock("@/lib/csrf", () => ({ verifyCsrfToken: mocks.csrf }));
vi.mock("@/lib/student-portal-auth", () => ({ requireStudentPortalSession: mocks.session }));
vi.mock("@/lib/student-course-learning", () => ({ saveStudentLessonProgress: mocks.save }));
vi.mock("@/lib/db", () => ({ getDb: () => mocks.db }));

import { POST } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.boundary.mockReturnValue(null);
  mocks.csrf.mockResolvedValue(true);
  mocks.readJson.mockResolvedValue({ lessonId: "lesson-1", watchedSeconds: 90, markedComplete: false });
  mocks.session.mockResolvedValue({ session: { vendorId: "vendor-1", customerKeyHash: "learner-key" } });
  mocks.save.mockResolvedValue({ lessonId: "lesson-1", watchedSeconds: 90, completedAt: "2026-09-09T00:00:00.000Z" });
});

describe("student course progress route", () => {
  it("writes a parsed checkpoint only through the authenticated tenant-student scope", async () => {
    const response = await POST(new Request("https://app.example.test/portal/teacher/learn/course-1/progress", { method: "POST", headers: { "x-csrf-token": "csrf-token" } }), { params: Promise.resolve({ vendorSlug: "teacher", courseId: "course-1" }) });
    expect(mocks.session).toHaveBeenCalledWith("teacher");
    expect(mocks.save).toHaveBeenCalledWith(mocks.db, { vendorId: "vendor-1", customerKeyHash: "learner-key" }, { courseId: "course-1", lessonId: "lesson-1", watchedSeconds: 90, markedComplete: false });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("fails closed before session/database work when CSRF verification fails", async () => {
    mocks.csrf.mockResolvedValue(false);
    const response = await POST(new Request("https://app.example.test/portal/teacher/learn/course-1/progress", { method: "POST" }), { params: Promise.resolve({ vendorSlug: "teacher", courseId: "course-1" }) });
    expect(response.status).toBe(403);
    expect(mocks.session).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
