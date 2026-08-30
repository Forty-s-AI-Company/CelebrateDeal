import type { Prisma, PrismaClient } from "@prisma/client";
import { getDb } from "@/lib/db";
import { formatDateTime } from "@/lib/format";

export const FORM_SUBMISSION_PAGE_SIZE = 25;
export const FORM_SUBMISSION_QUERY_MAX_LENGTH = 160;

export type FormSubmissionVerificationFilter = "ALL" | "VERIFIED" | "UNVERIFIED";
export type FormSubmissionSourceFilter = "ALL" | "LIVE" | "FORM";

export type FormSubmissionSearchCriteria = {
  formId: string;
  query: string;
  verification: FormSubmissionVerificationFilter;
  source: FormSubmissionSourceFilter;
  page: number;
};

export type FormSubmissionListItem = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  source: string;
  liveTitle: string | null;
  verificationStatus: "VERIFIED" | "UNVERIFIED";
  createdAtLabel: string;
};

export type FormSubmissionSearchResult = {
  form: { id: string; name: string };
  criteria: FormSubmissionSearchCriteria;
  items: FormSubmissionListItem[];
  totalItems: number;
  page: number;
  totalPages: number;
  pageSize: number;
};

type SearchDatabase = Pick<PrismaClient, "registrationForm" | "formSubmission">;

export type FormSubmissionSearchParseResult =
  | { success: true; data: FormSubmissionSearchCriteria }
  | { success: false; message: string };

function readText(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export function parseFormSubmissionSearchInput(formData: FormData): FormSubmissionSearchParseResult {
  const formId = readText(formData, "formId").trim();
  if (!formId || formId.length > 128) {
    return { success: false, message: "找不到要查詢的報名表，請返回表單列表後重試。" };
  }

  // Avoid the reserved `reset` form-control name: named controls are exposed
  // on HTMLFormElement and would shadow its native reset() method.
  const reset = readText(formData, "resetFilters") === "1";
  const query = reset ? "" : readText(formData, "query").trim();
  if (query.length > FORM_SUBMISSION_QUERY_MAX_LENGTH) {
    return { success: false, message: `搜尋內容不可超過 ${FORM_SUBMISSION_QUERY_MAX_LENGTH} 個字。` };
  }

  const verificationRaw = reset ? "ALL" : readText(formData, "verification");
  const sourceRaw = reset ? "ALL" : readText(formData, "source");
  const verification: FormSubmissionVerificationFilter = verificationRaw === "VERIFIED" || verificationRaw === "UNVERIFIED"
    ? verificationRaw
    : "ALL";
  const source: FormSubmissionSourceFilter = sourceRaw === "LIVE" || sourceRaw === "FORM"
    ? sourceRaw
    : "ALL";

  const pageRaw = reset ? "1" : readText(formData, "page");
  const parsedPage = Number.parseInt(pageRaw, 10);
  const page = Number.isSafeInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;

  return { success: true, data: { formId, query, verification, source, page } };
}

export function buildFormSubmissionWhere(
  vendorId: string,
  criteria: FormSubmissionSearchCriteria,
): Prisma.FormSubmissionWhereInput {
  const where: Prisma.FormSubmissionWhereInput = {
    formId: criteria.formId,
    form: { vendorId },
  };

  if (criteria.query) {
    where.OR = [
      { name: { contains: criteria.query, mode: "insensitive" } },
      { email: { contains: criteria.query, mode: "insensitive" } },
      { phone: { contains: criteria.query, mode: "insensitive" } },
    ];
  }
  if (criteria.verification !== "ALL") {
    where.verificationStatus = criteria.verification;
  }
  if (criteria.source === "LIVE") where.liveId = { not: null };
  if (criteria.source === "FORM") where.liveId = null;

  return where;
}

export async function loadFormSubmissionSearchResult(
  vendorId: string,
  criteria: FormSubmissionSearchCriteria,
  database: SearchDatabase = getDb(),
): Promise<FormSubmissionSearchResult | null> {
  const form = await database.registrationForm.findFirst({
    where: { id: criteria.formId, vendorId },
    select: { id: true, name: true },
  });
  if (!form) return null;

  const where = buildFormSubmissionWhere(vendorId, criteria);
  const totalItems = await database.formSubmission.count({ where });
  const totalPages = Math.max(1, Math.ceil(totalItems / FORM_SUBMISSION_PAGE_SIZE));
  const page = Math.min(criteria.page, totalPages);
  const submissions = await database.formSubmission.findMany({
    where,
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      source: true,
      verificationStatus: true,
      createdAt: true,
      live: { select: { title: true } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * FORM_SUBMISSION_PAGE_SIZE,
    take: FORM_SUBMISSION_PAGE_SIZE,
  });

  return {
    form,
    criteria: { ...criteria, page },
    items: submissions.map((submission) => ({
      id: submission.id,
      name: submission.name,
      email: submission.email,
      phone: submission.phone,
      source: submission.source,
      liveTitle: submission.live?.title ?? null,
      verificationStatus: submission.verificationStatus,
      createdAtLabel: formatDateTime(submission.createdAt),
    })),
    totalItems,
    page,
    totalPages,
    pageSize: FORM_SUBMISSION_PAGE_SIZE,
  };
}
