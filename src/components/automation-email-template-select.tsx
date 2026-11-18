"use client";

import { useEffect, useRef, useState } from "react";
import { Field, SelectField, TextArea } from "@/components/ui";
import {
  AUTOMATION_EMAIL_TEMPLATE_LABELS,
  AUTOMATION_TRIGGER_LABELS,
  usableAutomationEmailTemplates,
  type AutomationEmailTemplate,
} from "@/lib/automation-email-template-availability";
import {
  GENERIC_EMAIL_BODY_MAX,
  GENERIC_EMAIL_SUBJECT_MAX,
  GENERIC_EMAIL_VARIABLE_LABELS,
  genericEmailVariablesForTrigger,
} from "@/lib/automation-generic-email";

const NO_LINK_SUFFIX = "（此觸發條件下沒有連結）";

function isTemplate(value: string): value is AutomationEmailTemplate {
  return value in AUTOMATION_EMAIL_TEMPLATE_LABELS;
}

/**
 * Email template of an automation action (Q-18): lists only the templates that
 * have their link on the rule's trigger. The rule form has the trigger in the
 * same form (`triggerFieldName`), so the list follows that select and the
 * voucher checkbox (`actionVoucher`, which gives `repurchase_followup` its
 * link); a delayed-step form has a fixed `trigger`. `keepTemplate`: the
 * template a stored step already has, kept in the list when it has no link so
 * an edit does not silently change it. The Server Actions check again.
 */
export function AutomationEmailTemplateSelect({ trigger, triggerFieldName, hasVoucher, defaultTemplate, keepTemplate, defaultSubject, defaultBody }: {
  trigger: string;
  /** The rule form's trigger select: its value replaces `trigger` and follows the merchant's choice. */
  triggerFieldName?: string;
  hasVoucher: boolean;
  defaultTemplate?: string | null;
  keepTemplate?: string | null;
  /** The stored subject and body of a 「自訂訊息」 action. */
  defaultSubject?: string | null;
  defaultBody?: string | null;
}) {
  const wrapper = useRef<HTMLDivElement>(null);
  const [currentTrigger, setCurrentTrigger] = useState(trigger);
  const [voucher, setVoucher] = useState(hasVoucher);
  const [selected, setSelected] = useState(defaultTemplate ?? "");

  useEffect(() => {
    const form = wrapper.current?.closest("form");
    if (!form) return;
    const read = () => {
      const triggerField = triggerFieldName ? form.elements.namedItem(triggerFieldName) : null;
      if (triggerField instanceof HTMLSelectElement) setCurrentTrigger(triggerField.value);
      const voucherField = form.elements.namedItem("actionVoucher");
      if (voucherField instanceof HTMLInputElement) setVoucher(voucherField.checked);
    };
    read();
    form.addEventListener("change", read);
    return () => form.removeEventListener("change", read);
  }, [triggerFieldName]);

  const usable = usableAutomationEmailTemplates(currentTrigger, { hasVoucher: voucher });
  const kept = keepTemplate && isTemplate(keepTemplate) && !usable.includes(keepTemplate) ? keepTemplate : null;
  const options = [...usable.map((template) => ({ value: template, label: AUTOMATION_EMAIL_TEMPLATE_LABELS[template] })), ...(kept ? [{ value: kept, label: `${AUTOMATION_EMAIL_TEMPLATE_LABELS[kept]}${NO_LINK_SUFFIX}` }] : [])];
  const value = options.some((option) => option.value === selected) ? selected : options[0]?.value ?? "";
  const triggerLabel = (AUTOMATION_TRIGGER_LABELS as Record<string, string>)[currentTrigger] ?? currentTrigger;
  const variables = genericEmailVariablesForTrigger(currentTrigger);
  const variableHint = variables.length
    ? `可用變數：${variables.map((variable) => `{{${variable}}}（${GENERIC_EMAIL_VARIABLE_LABELS[variable]}）`).join("、")}。`
    : "這個觸發條件沒有可用的變數。";
  const hint = !usable.length
    ? `「${triggerLabel}」的事件沒有可放進信裡的連結，目前沒有適用的 Email 範本。要寄信請改選其他觸發事件，或同時勾選「發送回購券」使用「追購通知」。`
    : !voucher
      ? "「追購通知」的領券連結來自同一份動作裡的回購券，勾選「發送回購券」後才能選。"
      : null;

  return <div ref={wrapper} className="grid gap-4">
    <SelectField label="Email 範本" name="emailTemplate" value={value} onChange={(event) => setSelected(event.target.value)} hint={hint}>
      {options.length
        ? options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)
        : <option value="">沒有適用的範本</option>}
    </SelectField>
    {value === "generic_message" ? <div className="grid gap-4">
      <Field label="Email 主旨" name="emailSubject" required maxLength={GENERIC_EMAIL_SUBJECT_MAX} defaultValue={defaultSubject} hint={`單行，最多 ${GENERIC_EMAIL_SUBJECT_MAX} 字，不能放連結或網址。`} />
      <TextArea label="Email 內文" name="emailBody" required rows={6} maxLength={GENERIC_EMAIL_BODY_MAX} defaultValue={defaultBody} hint={`最多 ${GENERIC_EMAIL_BODY_MAX} 字，換行會照樣保留，支援基本格式（粗體、標題、清單），但不能放連結、網址或網域，這些會被拒絕。${variableHint}收件人姓名只有在報名 Email 已驗證時才會帶入，否則顯示「你」；表單沒有綁定直播時，直播名稱顯示「本活動」。信末會自動附上退訂連結與商家聯絡資訊。`} />
    </div> : null}
  </div>;
}
