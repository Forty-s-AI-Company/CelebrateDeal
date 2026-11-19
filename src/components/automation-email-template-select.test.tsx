// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AutomationEmailTemplateSelect } from "./automation-email-template-select";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

const options = () => [...container.querySelectorAll<HTMLOptionElement>('select[name="emailTemplate"] option')].map((option) => option.value);
const select = () => container.querySelector<HTMLSelectElement>('select[name="emailTemplate"]')!;
async function change(element: HTMLInputElement | HTMLSelectElement, apply: () => void) {
  await act(async () => { apply(); element.dispatchEvent(new Event("change", { bubbles: true })); });
}

// The rule form: the template list follows the trigger select and the voucher checkbox.
function RuleForm() {
  return <form>
    <select name="trigger" defaultValue="form_registered">
      <option value="form_registered">表單報名成功</option>
      <option value="consultation_booked">諮詢預約成功</option>
      <option value="form_no_show">報名後未出席直播</option>
    </select>
    <AutomationEmailTemplateSelect trigger="form_registered" triggerFieldName="trigger" hasVoucher={false} />
    <input type="checkbox" name="actionVoucher" />
    <input type="checkbox" name="actionEmail" />
  </form>;
}

describe("AutomationEmailTemplateSelect (Q-18)", () => {
  it("follows the trigger the merchant picks in the same form", async () => {
    await act(async () => root.render(<RuleForm />));
    expect(options()).toEqual(["generic_message"]);
    const trigger = container.querySelector<HTMLSelectElement>('select[name="trigger"]')!;
    await change(trigger, () => { trigger.value = "consultation_booked"; });
    expect(options()).toEqual(["consultation_confirmation", "generic_message"]);
    expect(select().value).toBe("consultation_confirmation");
    await change(trigger, () => { trigger.value = "form_no_show"; });
    expect(options()).toEqual(["webinar_replay", "generic_message"]);
    await change(trigger, () => { trigger.value = "form_registered"; });
    expect(options()).toEqual(["generic_message"]);
  });

  it("adds 追購通知 only while the voucher checkbox of the same form is ticked", async () => {
    await act(async () => root.render(<RuleForm />));
    const voucher = container.querySelector<HTMLInputElement>('input[name="actionVoucher"]')!;
    await change(voucher, () => { voucher.checked = true; });
    expect(options()).toEqual(["repurchase_followup", "generic_message"]);
    await change(voucher, () => { voucher.checked = false; });
    expect(options()).toEqual(["generic_message"]);
  });

  it("keeps the chosen template while it stays valid and falls back to the first one when it does not", async () => {
    await act(async () => root.render(<RuleForm />));
    const trigger = container.querySelector<HTMLSelectElement>('select[name="trigger"]')!;
    await change(trigger, () => { trigger.value = "form_no_show"; });
    await change(select(), () => { select().value = "webinar_replay"; });
    expect(select().value).toBe("webinar_replay");
    await change(trigger, () => { trigger.value = "consultation_booked"; });
    expect(select().value).toBe("consultation_confirmation");
  });

  it("keeps a stored step's own template in the list, marked as without a link", async () => {
    await act(async () => root.render(<form><AutomationEmailTemplateSelect trigger="form_registered" hasVoucher={false} defaultTemplate="class_reminder" keepTemplate="class_reminder" /></form>));
    expect(options()).toEqual(["generic_message", "class_reminder"]);
    expect(container.textContent).toContain("課前提醒（此觸發條件下沒有連結）");
    expect(select().value).toBe("class_reminder");
  });

  // A2-04: the link-free template asks for its own subject and body.
  it("shows the subject and body fields only for the generic template, with the variables of the trigger", async () => {
    await act(async () => root.render(<RuleForm />));
    const field = (name: string) => container.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${name}"]`);
    expect(select().value).toBe("generic_message");
    expect(field("emailSubject")?.getAttribute("maxlength")).toBe("100");
    expect(field("emailBody")?.getAttribute("maxlength")).toBe("2000");
    expect(container.textContent).toContain("{{name}}（收件人姓名）");
    expect(container.textContent).toContain("{{live_title}}（直播名稱）");
    expect(container.textContent).toContain("不能放連結、網址或網域");
    expect(container.textContent).toContain("支援基本格式");
    expect(container.textContent).toContain("已驗證");
    expect(container.textContent).toContain("本活動");
    expect(container.textContent).not.toContain("純文字");
    const trigger = container.querySelector<HTMLSelectElement>('select[name="trigger"]')!;
    await change(trigger, () => { trigger.value = "consultation_booked"; });
    expect(select().value).toBe("consultation_confirmation");
    expect(field("emailSubject")).toBeNull();
    expect(field("emailBody")).toBeNull();
    await change(select(), () => { select().value = "generic_message"; });
    expect(field("emailSubject")).not.toBeNull();
    expect(container.textContent).not.toContain("{{live_title}}");
  });

  // #665 CI: the fields exist (and show) while the action is off, so they must not block a rule that only tags.
  it("makes the subject and body mandatory only while the form's Email 通知 box is ticked", async () => {
    await act(async () => root.render(<RuleForm />));
    const subject = () => container.querySelector<HTMLInputElement>('input[name="emailSubject"]')!;
    const body = () => container.querySelector<HTMLTextAreaElement>('textarea[name="emailBody"]')!;
    expect(subject().required).toBe(false);
    expect(body().required).toBe(false);
    const email = container.querySelector<HTMLInputElement>('input[name="actionEmail"]')!;
    await change(email, () => { email.checked = true; });
    expect(subject().required).toBe(true);
    expect(body().required).toBe(true);
    await change(email, () => { email.checked = false; });
    expect(subject().required).toBe(false);
  });

  it("starts mandatory when a stored action already sends the e-mail", async () => {
    await act(async () => root.render(<form><input type="checkbox" name="actionEmail" defaultChecked /><AutomationEmailTemplateSelect trigger="payment_paid" hasVoucher={false} defaultTemplate="generic_message" defaultSubject="a" defaultBody="b" /></form>));
    expect(container.querySelector<HTMLInputElement>('input[name="emailSubject"]')!.required).toBe(true);
  });

  it("fills a stored generic action back into its fields", async () => {
    await act(async () => root.render(<form><AutomationEmailTemplateSelect trigger="payment_paid" hasVoucher={false} defaultTemplate="generic_message" defaultSubject="感謝購買" defaultBody={"謝謝你\n{{vendor_name}}"} /></form>));
    expect(container.querySelector<HTMLInputElement>('input[name="emailSubject"]')?.value).toBe("感謝購買");
    expect(container.querySelector<HTMLTextAreaElement>('textarea[name="emailBody"]')?.value).toBe("謝謝你\n{{vendor_name}}");
    expect(container.textContent).toContain("{{vendor_name}}（商家名稱）");
    expect(container.textContent).not.toContain("{{name}}");
  });
});
