import { beforeEach, describe, expect, it, vi } from "vitest";

const testRuntime = vi.hoisted(() => ({
  assertServerActionSecurity: vi.fn(),
  requireVendorManager: vi.fn(),
  vendorUpdate: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn((path: string): never => {
    throw new Error(`redirect:${path}`);
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: testRuntime.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: testRuntime.redirect }));
vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: testRuntime.assertServerActionSecurity }));
vi.mock("@/lib/auth", () => ({ requireVendorManager: testRuntime.requireVendorManager }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ vendor: { update: testRuntime.vendorUpdate } }) }));

import { saveBrandSettingsAction, saveBrandSettingsActionState, type BrandSettingsActionState } from "@/app/actions/brand-settings-actions";

function brandFormData(contactUrl: string) {
  const formData = new FormData();
  formData.set("name", "測試品牌");
  formData.set("slug", "test-brand");
  formData.set("primaryColor", "#2563eb");
  formData.set("ctaColor", "#f97316");
  formData.set("timezone", "Asia/Taipei");
  formData.set("supportEmail", "support@example.test");
  formData.set("senderName", "測試寄件人");
  formData.set("contactUrl", contactUrl);
  formData.set("logoUploadPhase", "idle");
  return formData;
}

const initialState: BrandSettingsActionState = {
  status: "idle",
  message: "",
  values: {
    name: "",
    slug: "",
    primaryColor: "",
    ctaColor: "",
    timezone: "Asia/Taipei",
    supportEmail: "",
    senderName: "",
    contactUrl: "",
    logoUrl: "",
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  testRuntime.assertServerActionSecurity.mockResolvedValue(undefined);
  testRuntime.requireVendorManager.mockResolvedValue({ id: "vendor-1" });
  testRuntime.vendorUpdate.mockResolvedValue({});
});

const REJECTED_CONTACT_URLS = [
  // IPv4: 0/8, 10/8, 127/8, 169.254/16, 172.16/12 (both edges), 192.168/16
  "https://0.0.0.0/contact",
  "https://0.1.2.3/contact",
  "https://10.0.0.1/contact",
  "https://10.255.255.255/contact",
  "https://127.0.0.1/contact",
  "https://127.255.255.254/contact",
  "https://169.254.169.254/latest/meta-data",
  "https://172.16.0.1/contact",
  "https://172.31.255.255/contact",
  "https://192.168.0.1/contact",
  // hostnames that resolve locally
  "https://localhost/contact",
  "https://LOCALHOST/contact",
  "https://localhost./contact",
  "https://shop.localhost/contact",
  "https://a.b.localhost./contact",
  // IPv6 loopback / unspecified / unique-local / link-local
  "https://[::1]/contact",
  "https://[::]/contact",
  "https://[0:0:0:0:0:0:0:1]/contact",
  "https://[fc00::1]/contact",
  "https://[fd12:3456:789a::1]/contact",
  "https://[fe80::1]/contact",
  "https://[febf::1]/contact",
  // IPv4-mapped IPv6 pointing at private / special IPv4
  "https://[::ffff:10.0.0.1]/contact",
  "https://[::ffff:127.0.0.1]/contact",
  "https://[::ffff:169.254.169.254]/contact",
  "https://[::ffff:172.16.0.1]/contact",
  "https://[::ffff:192.168.1.1]/contact",
  "https://[::ffff:0.0.0.0]/contact",
  "https://[::ffff:a00:1]/contact",
  "https://[::ffff:7f00:1]/contact",
  // non-HTTPS and embedded credentials
  "http://example.test/contact",
  "https://user:secret@example.test/contact",
];

const ACCEPTED_CONTACT_URLS: Array<[string, string]> = [
  ["https://example.test/contact?source=brand#support", "https://example.test/contact?source=brand#support"],
  ["https://shop.example.com/", "https://shop.example.com/"],
  ["https://localhost.example.com/contact", "https://localhost.example.com/contact"],
  ["https://8.8.8.8/contact", "https://8.8.8.8/contact"],
  ["https://172.15.255.255/contact", "https://172.15.255.255/contact"],
  ["https://172.32.0.1/contact", "https://172.32.0.1/contact"],
  ["https://169.253.1.1/contact", "https://169.253.1.1/contact"],
  ["https://[2001:4860:4860::8888]/contact", "https://[2001:4860:4860::8888]/contact"],
  ["https://[::ffff:8.8.8.8]/contact", "https://[::ffff:808:808]/contact"],
];

describe("brand settings contact URL SSRF guard", () => {
  it.each(REJECTED_CONTACT_URLS)("rejects %s without updating the vendor (action state)", async (contactUrl) => {
    const result = await saveBrandSettingsActionState(initialState, brandFormData(contactUrl));

    expect(result.status).toBe("error");
    expect(result.message).toContain("聯絡網址無效");
    expect(result.values.contactUrl).toBe(contactUrl);
    expect(testRuntime.vendorUpdate).not.toHaveBeenCalled();
  });

  it.each(REJECTED_CONTACT_URLS)("rejects %s without updating the vendor (redirect action)", async (contactUrl) => {
    await expect(saveBrandSettingsAction(brandFormData(contactUrl))).rejects.toThrow(
      "redirect:/settings/brand?error=invalid_contact_url",
    );

    expect(testRuntime.vendorUpdate).not.toHaveBeenCalled();
  });

  it.each(ACCEPTED_CONTACT_URLS)("accepts the public address %s", async (contactUrl, stored) => {
    await expect(saveBrandSettingsAction(brandFormData(contactUrl))).resolves.toBeUndefined();

    expect(testRuntime.vendorUpdate).toHaveBeenCalledWith({
      where: { id: "vendor-1" },
      data: expect.objectContaining({ contactUrl: stored }),
    });
  });
});
