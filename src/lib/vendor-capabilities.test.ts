import { describe, expect, it } from "vitest";
import {
  canManageCommerceProducts,
  canManageCourses,
  canManageMessageDelivery,
  canManageLiveRooms,
  canManageVideos,
  canViewCourseEnrollmentPii,
} from "@/lib/vendor-capabilities";

describe("vendor commerce capabilities", () => {
  it.each(["owner", "admin"])("allows %s to manage products", (role) => {
    expect(canManageCommerceProducts(role)).toBe(true);
  });

  it.each(["accountant", "staff", null, undefined])("denies %s from product mutations", (role) => {
    expect(canManageCommerceProducts(role)).toBe(false);
  });

  it("uses the same owner/admin boundary for course publishing", () => {
    expect(canManageCourses("owner")).toBe(true);
    expect(canManageCourses("admin")).toBe(true);
    expect(canManageCourses("accountant")).toBe(false);
  });

  it("keeps course enrollment PII away from staff and finance-only roles", () => {
    expect(canViewCourseEnrollmentPii("owner")).toBe(true);
    expect(canViewCourseEnrollmentPii("admin")).toBe(true);
    expect(canViewCourseEnrollmentPii("accountant")).toBe(false);
    expect(canViewCourseEnrollmentPii("staff")).toBe(false);
  });

  it("keeps message templates and recipient PII away from accountants", () => {
    expect(canManageMessageDelivery("owner")).toBe(true);
    expect(canManageMessageDelivery("admin")).toBe(true);
    expect(canManageMessageDelivery("accountant")).toBe(false);
  });

  it("allows operating staff, but not accountants, to manage live rooms", () => {
    expect(canManageLiveRooms("owner")).toBe(true);
    expect(canManageLiveRooms("admin")).toBe(true);
    expect(canManageLiveRooms("staff")).toBe(true);
    expect(canManageLiveRooms("accountant")).toBe(false);
  });

  it("uses the live-operations boundary for video library changes", () => {
    expect(canManageVideos("staff")).toBe(true);
    expect(canManageVideos("accountant")).toBe(false);
  });
});
