import { describe, expect, it, vi } from "vitest";
import {
  buildFormSubmissionWhere,
  FORM_SUBMISSION_PAGE_SIZE,
  loadFormSubmissionSearchResult,
  parseFormSubmissionSearchInput,
} from "./form-submission-search";

function searchFormData(entries: Record<string, string>) {
  const formData = new FormData();
  for (const [name, value] of Object.entries(entries)) formData.set(name, value);
  return formData;
}

describe("form submission search input", () => {
  it("normalizes filters and falls back to the first page", () => {
    const parsed = parseFormSubmissionSearchInput(searchFormData({
      formId: " form-1 ",
      query: " safe@example.test ",
      verification: "VERIFIED",
      source: "LIVE",
      page: "not-a-page",
    }));
    expect(parsed).toEqual({
      success: true,
      data: { formId: "form-1", query: "safe@example.test", verification: "VERIFIED", source: "LIVE", page: 1 },
    });
  });

  it("resets all filters without trusting submitted values", () => {
    const parsed = parseFormSubmissionSearchInput(searchFormData({
      formId: "form-1",
      query: "private search",
      verification: "VERIFIED",
      source: "LIVE",
      page: "8",
      resetFilters: "1",
    }));
    expect(parsed).toEqual({
      success: true,
      data: { formId: "form-1", query: "", verification: "ALL", source: "ALL", page: 1 },
    });
  });

  it("rejects missing form identity and oversized search content", () => {
    expect(parseFormSubmissionSearchInput(searchFormData({}))).toMatchObject({ success: false });
    expect(parseFormSubmissionSearchInput(searchFormData({ formId: "form-1", query: "x".repeat(161) }))).toEqual({
      success: false,
      message: "搜尋內容不可超過 160 個字。",
    });
  });
});

describe("form submission search query", () => {
  it("scopes every query to the authenticated vendor and selected filters", () => {
    expect(buildFormSubmissionWhere("vendor-1", {
      formId: "form-1",
      query: "eden",
      verification: "UNVERIFIED",
      source: "FORM",
      page: 1,
    })).toEqual({
      formId: "form-1",
      form: { vendorId: "vendor-1" },
      OR: [
        { name: { contains: "eden", mode: "insensitive" } },
        { email: { contains: "eden", mode: "insensitive" } },
        { phone: { contains: "eden", mode: "insensitive" } },
      ],
      verificationStatus: "UNVERIFIED",
      liveId: null,
    });
  });

  it("clamps pagination and selects only fields needed by the list", async () => {
    const database = {
      registrationForm: { findFirst: vi.fn().mockResolvedValue({ id: "form-1", name: "活動報名" }) },
      formSubmission: {
        count: vi.fn().mockResolvedValue(51),
        findMany: vi.fn().mockResolvedValue([{
          id: "submission-51",
          name: "王小明",
          email: "safe@example.test",
          phone: null,
          source: "form",
          verificationStatus: "VERIFIED",
          createdAt: new Date("2026-08-10T01:00:00.000Z"),
          live: { title: "新品直播" },
        }]),
      },
    };
    const result = await loadFormSubmissionSearchResult("vendor-1", {
      formId: "form-1",
      query: "",
      verification: "ALL",
      source: "ALL",
      page: 99,
    }, database as unknown as Parameters<typeof loadFormSubmissionSearchResult>[2]);

    expect(database.registrationForm.findFirst).toHaveBeenCalledWith({
      where: { id: "form-1", vendorId: "vendor-1" },
      select: { id: true, name: true },
    });
    expect(database.formSubmission.findMany).toHaveBeenCalledWith(expect.objectContaining({
      skip: 2 * FORM_SUBMISSION_PAGE_SIZE,
      take: FORM_SUBMISSION_PAGE_SIZE,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: expect.not.objectContaining({ answers: true }),
    }));
    expect(result).toMatchObject({ totalItems: 51, page: 3, totalPages: 3, pageSize: 25 });
    expect(result?.items[0]).toMatchObject({ liveTitle: "新品直播", verificationStatus: "VERIFIED" });
    expect(result?.items[0]?.createdAtLabel).toBeTruthy();
  });

  it("fails closed before reading submissions when the form is outside the tenant", async () => {
    const database = {
      registrationForm: { findFirst: vi.fn().mockResolvedValue(null) },
      formSubmission: { count: vi.fn(), findMany: vi.fn() },
    };
    await expect(loadFormSubmissionSearchResult("vendor-1", {
      formId: "other-form",
      query: "",
      verification: "ALL",
      source: "ALL",
      page: 1,
    }, database as unknown as Parameters<typeof loadFormSubmissionSearchResult>[2])).resolves.toBeNull();
    expect(database.formSubmission.count).not.toHaveBeenCalled();
    expect(database.formSubmission.findMany).not.toHaveBeenCalled();
  });
});
