import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  notFound: vi.fn(() => { throw new Error("NOT_FOUND"); }),
}));

vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ registrationForm: { findUnique: mocks.findUnique } }) }));
vi.mock("@/components/lead-form", () => ({
  LeadForm: ({ fields }: { fields: Array<{ key: string }> }) => <div data-testid="lead-form">{fields.map((field) => field.key).join(",")}</div>,
}));

import PublicFormPage from "./page";

const validFields = [
  { key: "name", label: "姓名", type: "text", required: true },
  { key: "email", label: "Email", type: "email", required: true },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findUnique.mockResolvedValue({
    id: "form-1",
    slug: "summer",
    headline: "立即報名",
    description: "活動說明",
    submitLabel: "送出",
    successMessage: "完成",
    isActive: true,
    fields: validFields,
    vendor: { name: "測試商家" },
  });
});

describe("public registration form", () => {
  it("renders only a server-validated field schema", async () => {
    const html = renderToStaticMarkup(await PublicFormPage({
      params: Promise.resolve({ slug: "summer" }),
      searchParams: Promise.resolve({}),
    }));

    expect(mocks.findUnique).toHaveBeenCalledWith({ where: { slug: "summer" }, include: { vendor: true } });
    expect(html).toContain("立即報名");
    expect(html).toContain("name,email");
    expect(html).not.toContain("暫停接收資料");
  });

  it("fails closed with a clear unavailable state for an invalid legacy schema", async () => {
    mocks.findUnique.mockResolvedValue({
      id: "legacy-form",
      slug: "legacy",
      headline: "舊表單",
      description: null,
      submitLabel: "送出",
      successMessage: "完成",
      isActive: true,
      fields: [{ key: "email", label: "Email", type: "email", required: true }],
      vendor: { name: "測試商家" },
    });

    const html = renderToStaticMarkup(await PublicFormPage({
      params: Promise.resolve({ slug: "legacy" }),
      searchParams: Promise.resolve({}),
    }));

    expect(html).toContain('role="alert"');
    expect(html).toContain("暫停接收資料");
    expect(html).not.toContain('data-testid="lead-form"');
  });

  it("keeps inactive or missing forms unavailable", async () => {
    mocks.findUnique.mockResolvedValue(null);
    await expect(PublicFormPage({ params: Promise.resolve({ slug: "missing" }), searchParams: Promise.resolve({}) })).rejects.toThrow("NOT_FOUND");
    expect(mocks.notFound).toHaveBeenCalledOnce();
  });
});
