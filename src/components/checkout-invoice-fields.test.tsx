// @vitest-environment happy-dom
import { act, type FormEvent } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CheckoutInvoiceFields, invoiceFieldError } from "@/components/checkout-invoice-fields";

describe("CheckoutInvoiceFields", () => {
  it("renders personal, company, donation and carrier choices", () => {
    const html = renderToStaticMarkup(<CheckoutInvoiceFields />);
    expect(html).toContain('name="invoiceType"');
    expect(html).toContain('value="personal"');
    expect(html).toContain('value="company"');
    expect(html).toContain('value="donation"');
    expect(html).toContain('value="mobile"');
    expect(html).toContain('value="citizen_certificate"');
    expect(html).toContain('role="alert"');
    expect(html).toContain("自動電子發票尚未開放");
    expect(html).toContain("本頁僅收集發票需求");
    expect(html).toContain("該筆交易的開立主體會依法開立並提供發票");
    expect(html).not.toContain("開立方式請洽商家");
    expect(html).toContain("填寫資料或付款成功均不代表已開立");
  });

  it("keeps the unavailable notice visible when payment fields are disabled", () => {
    const html = renderToStaticMarkup(<CheckoutInvoiceFields disabled />);
    expect(html).toContain('disabled=""');
    expect(html).toContain("自動電子發票尚未開放");
    expect(html).toContain('name="invoiceType"');
  });

  it("returns immediate errors for invalid switched-field values", () => {
    expect(invoiceFieldError({ type: "personal", carrier: "mobile", carrierNumber: "/abc1234" })).toBe("手機條碼格式不正確。");
    expect(invoiceFieldError({ type: "personal", carrier: "mobile", carrierNumber: "/ABC1234" })).toBeNull();
    expect(invoiceFieldError({ type: "company", businessId: "12345678", companyName: "公司" })).toContain("統一編號");
    expect(invoiceFieldError({ type: "company", businessId: "04595257", companyName: "" })).toContain("抬頭");
    expect(invoiceFieldError({ type: "donation", donationCode: "123" })).toBeNull();
  });

  it("keeps the whole-value validator results for every selection", () => {
    expect(invoiceFieldError({ type: "personal", carrier: "member" })).toBeNull();
    expect(invoiceFieldError({ type: "personal" })).toBeNull();
    expect(invoiceFieldError({ type: "personal", carrier: "citizen_certificate", carrierNumber: "AB1234" })).toBe("自然人憑證載具格式不正確。");
    expect(invoiceFieldError({ type: "personal", carrier: "citizen_certificate", carrierNumber: "AB12345678901234" })).toBeNull();
    expect(invoiceFieldError({ type: "company", businessId: "04595257", companyName: "合成公司" })).toBeNull();
    expect(invoiceFieldError({ type: "donation", donationCode: "12" })).toBe("愛心捐贈碼須為 3 至 7 碼數字。");
  });
});

describe("CheckoutInvoiceFields interaction", () => {
  let container: HTMLDivElement;
  let root: Root;
  let submitted: ReturnType<typeof vi.fn<(event: FormEvent<HTMLFormElement>) => void>>;

  beforeEach(async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    submitted = vi.fn((event: FormEvent<HTMLFormElement>) => event.preventDefault());
    await act(async () => { root.render(<form onSubmit={submitted}><CheckoutInvoiceFields /></form>); });
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.remove();
  });

  const alertText = () => container.querySelector('[role="alert"]')!.textContent ?? "";
  const field = (name: string) => container.querySelector<HTMLInputElement>(`[name="${name}"]`);
  async function select(name: string, value: string) {
    const element = container.querySelector<HTMLSelectElement>(`select[name="${name}"]`)!;
    await act(async () => {
      element.value = value;
      // Browsers fire both input and change when a select option is chosen.
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }
  async function type(name: string, value: string) {
    const input = field(name)!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  async function blur(name: string) {
    await act(async () => { field(name)!.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
  }
  async function submit() {
    const event = new Event("submit", { bubbles: true, cancelable: true });
    await act(async () => { container.querySelector("form")!.dispatchEvent(event); });
    return event;
  }

  it("shows no error after merely choosing any invoice type or carrier", async () => {
    expect(alertText()).toBe("");
    for (const carrier of ["mobile", "citizen_certificate", "member"]) {
      await select("invoiceCarrier", carrier);
      expect(alertText()).toBe("");
    }
    for (const invoiceType of ["company", "donation", "personal"]) {
      await select("invoiceType", invoiceType);
      expect(alertText()).toBe("");
    }
    expect(container.querySelector('[aria-invalid="true"]')).toBeNull();
    const alert = container.querySelector('[role="alert"]')!;
    expect(alert.className).toContain("min-h-5");
  });

  it("does not flag an untouched empty field on blur or the first keystrokes", async () => {
    await select("invoiceCarrier", "mobile");
    await blur("invoiceCarrierNumber");
    expect(alertText()).toBe("");
    await type("invoiceCarrierNumber", "/AB");
    expect(alertText()).toBe("");
  });

  it.each([
    ["personal", "mobile", "invoiceCarrierNumber", "/abc1234", "/ABC1234", "手機條碼格式不正確。"],
    ["personal", "citizen_certificate", "invoiceCarrierNumber", "AB123", "AB12345678901234", "自然人憑證載具格式不正確。"],
    ["company", null, "invoiceBusinessId", "12345678", "04595257", "請輸入有效的 8 碼統一編號。"],
    ["company", null, "invoiceCompanyName", "   ", "合成公司", "請填寫發票抬頭。"],
    ["donation", null, "invoiceDonationCode", "12", "123", "愛心捐贈碼須為 3 至 7 碼數字。"],
  ])("validates %s/%s %s only after input and blur, then clears once valid", async (invoiceType, carrier, name, invalid, valid, message) => {
    await select("invoiceType", invoiceType);
    if (carrier) await select("invoiceCarrier", carrier);
    await type(name, invalid);
    expect(alertText()).toBe("");
    await blur(name);
    expect(alertText()).toBe(message);
    expect(field(name)!.getAttribute("aria-invalid")).toBe("true");
    expect(field(name)!.getAttribute("aria-describedby")).toContain("invoice-field-error");
    // Once touched, typing updates the message live and clears it when valid.
    await type(name, valid);
    expect(alertText()).toBe("");
    expect(field(name)!.hasAttribute("aria-invalid")).toBe(false);
  });

  it("clears an old carrier or type error when the selection changes", async () => {
    await select("invoiceCarrier", "citizen_certificate");
    await type("invoiceCarrierNumber", "AB1");
    await blur("invoiceCarrierNumber");
    expect(alertText()).toBe("自然人憑證載具格式不正確。");
    await select("invoiceCarrier", "member");
    expect(alertText()).toBe("");
    await select("invoiceCarrier", "mobile");
    expect(alertText()).toBe("");
    expect(field("invoiceCarrierNumber")!.value).toBe("");

    await select("invoiceType", "company");
    await type("invoiceBusinessId", "1234");
    await blur("invoiceBusinessId");
    expect(alertText()).toBe("請輸入有效的 8 碼統一編號。");
    await select("invoiceType", "donation");
    expect(alertText()).toBe("");
  });

  it("keeps native required and pattern constraints and explains a native invalid event", async () => {
    await select("invoiceType", "donation");
    const input = field("invoiceDonationCode")!;
    expect(input.required).toBe(true);
    expect(input.getAttribute("pattern")).toBe("[0-9]{3,7}");
    await act(async () => { input.dispatchEvent(new Event("invalid", { cancelable: true })); });
    expect(alertText()).toBe("愛心捐贈碼須為 3 至 7 碼數字。");
  });

  it("lets the default member carrier submit without any format error", async () => {
    const event = await submit();
    expect(submitted).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    expect(alertText()).toBe("");
  });

  it("fully validates the current selection before submit and focuses the invalid field", async () => {
    await select("invoiceType", "company");
    // 8 digits satisfy the native pattern but fail the business-id checksum.
    await type("invoiceBusinessId", "12345678");
    await type("invoiceCompanyName", "合成公司");
    const blocked = await submit();
    expect(blocked.defaultPrevented).toBe(true);
    expect(submitted).not.toHaveBeenCalled();
    expect(alertText()).toBe("請輸入有效的 8 碼統一編號。");
    expect(document.activeElement).toBe(field("invoiceBusinessId"));

    await type("invoiceBusinessId", "04595257");
    expect(alertText()).toBe("");
    await submit();
    expect(submitted).toHaveBeenCalledTimes(1);
  });

  it("does not block a submit while the invoice fields are disabled", async () => {
    await act(async () => { root.render(<form onSubmit={submitted}><fieldset id="checkout-step"><CheckoutInvoiceFields /></fieldset></form>); });
    await select("invoiceType", "company");
    await type("invoiceBusinessId", "12345678");
    // Two-step checkout disables the order step while the buyer edits contact data.
    container.querySelector<HTMLFieldSetElement>("#checkout-step")!.disabled = true;
    await submit();
    expect(submitted).toHaveBeenCalledTimes(1);
  });
});
