import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type BrandSettingsFormProps = {
  initialValues: Record<string, string>;
  csrfField: ReactNode;
};

const mocks = vi.hoisted(() => ({
  brandSettingsForm: vi.fn(),
  requireVendorManager: vi.fn(),
}));

vi.mock("@/components/brand-settings-form", () => ({
  BrandSettingsForm: (props: BrandSettingsFormProps) => {
    mocks.brandSettingsForm(props);
    return <div data-testid="brand-settings-form">{props.csrfField}</div>;
  },
}));
vi.mock("@/lib/auth", () => ({ requireVendorManager: mocks.requireVendorManager }));
vi.mock("@/components/csrf-field", () => ({ CsrfField: () => <input type="hidden" name="_csrf" value="test-csrf" /> }));

import BrandSettingsPage from "./page";

describe("brand settings page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireVendorManager.mockResolvedValue({
      id: "vendor-1",
      name: "測試品牌",
      slug: "test-brand",
      primaryColor: "#2563eb",
      ctaColor: "#f97316",
      timezone: "Asia/Taipei",
      supportEmail: "support@example.test",
      logoUrl: null,
    });
  });

  it("passes only public tenant values and the current timezone to the client form", async () => {
    const html = renderToStaticMarkup(await BrandSettingsPage());
    const props = mocks.brandSettingsForm.mock.calls[0]?.[0] as BrandSettingsFormProps;

    expect(props.initialValues).toEqual({
      name: "測試品牌",
      slug: "test-brand",
      primaryColor: "#2563eb",
      ctaColor: "#f97316",
      timezone: "Asia/Taipei",
      supportEmail: "support@example.test",
      logoUrl: "",
    });
    expect(props.initialValues).not.toHaveProperty("id");
    expect(html).toContain('name="_csrf" value="test-csrf"');
    expect(html).not.toContain("invalid_timezone");
  });
});
