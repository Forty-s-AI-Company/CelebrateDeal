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
  </form>;
}

describe("AutomationEmailTemplateSelect (Q-18)", () => {
  it("follows the trigger the merchant picks in the same form", async () => {
    await act(async () => root.render(<RuleForm />));
    expect(options()).toEqual([""]);
    const trigger = container.querySelector<HTMLSelectElement>('select[name="trigger"]')!;
    await change(trigger, () => { trigger.value = "consultation_booked"; });
    expect(options()).toEqual(["consultation_confirmation"]);
    expect(select().value).toBe("consultation_confirmation");
    await change(trigger, () => { trigger.value = "form_no_show"; });
    expect(options()).toEqual(["webinar_replay"]);
    await change(trigger, () => { trigger.value = "form_registered"; });
    expect(options()).toEqual([""]);
  });

  it("adds 追購通知 only while the voucher checkbox of the same form is ticked", async () => {
    await act(async () => root.render(<RuleForm />));
    const voucher = container.querySelector<HTMLInputElement>('input[name="actionVoucher"]')!;
    await change(voucher, () => { voucher.checked = true; });
    expect(options()).toEqual(["repurchase_followup"]);
    await change(voucher, () => { voucher.checked = false; });
    expect(options()).toEqual([""]);
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
    expect(options()).toEqual(["class_reminder"]);
    expect(container.textContent).toContain("課前提醒（此觸發條件下沒有連結）");
    expect(select().value).toBe("class_reminder");
  });
});
