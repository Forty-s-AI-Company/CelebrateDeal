"use client";

import { useState } from "react";
import { Field, SelectField } from "@/components/ui";

/** 1 hour to 90 days (AUTOMATION_STEP_MIN/MAX_DELAY_MINUTES): the input's max follows the chosen unit. */
const MAX_BY_UNIT = { hours: 2_160, days: 90 } as const;

export type AutomationStepDelayUnit = keyof typeof MAX_BY_UNIT;

/**
 * Delay value and unit of a delayed automation step: hours or days only, at
 * least 1 hour (docs/product/delayed-steps-design.md §3「時間精度」). The
 * server checks the range again (automation-delayed-steps.ts).
 */
export function AutomationStepDelayFields({ value, unit }: { value: number; unit: AutomationStepDelayUnit }) {
  const [current, setCurrent] = useState<AutomationStepDelayUnit>(unit);
  return <div className="grid gap-4 md:grid-cols-2">
    <Field label="事件發生後多久執行" name="delayValue" type="number" min={1} max={MAX_BY_UNIT[current]} step={1} required defaultValue={value} hint={current === "days" ? "1 到 90 天" : "1 到 2160 小時（90 天）"} />
    <SelectField label="單位" name="delayUnit" value={current} onChange={(event) => setCurrent(event.target.value === "hours" ? "hours" : "days")}>
      <option value="hours">小時</option>
      <option value="days">天</option>
    </SelectField>
  </div>;
}
