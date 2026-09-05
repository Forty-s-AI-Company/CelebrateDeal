import { parseCommissionRule } from "@/lib/commission-rule-engine";

function values(formData: FormData, key: string) {
  return formData.getAll(key).map((value) => typeof value === "string" ? value.trim() : "");
}

function integer(value: FormDataEntryValue | null, field: string, minimum = 0) {
  const parsed = typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < minimum) throw new Error(`${field} 格式不正確。 `);
  return parsed;
}

export function parseCommissionRuleForm(formData: FormData) {
  const currencyValue = formData.get("currency");
  const currency = typeof currencyValue === "string" ? currencyValue.trim().toUpperCase() : "";
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("幣別必須是三碼 ISO 代碼。 ");
  const thresholds = values(formData, "tierMinAmount");
  const rates = values(formData, "tierRateBps");
  if (thresholds.length !== rates.length) throw new Error("階梯門檻與費率筆數不一致。 ");
  const tiers = thresholds.flatMap((threshold, index) => {
    const rate = rates[index] ?? "";
    if (!threshold && !rate) return [];
    if (!threshold || !rate) throw new Error("每個階梯都必須同時填寫門檻與費率。 ");
    const amountUnits = integer(threshold, `第 ${index + 1} 階門檻`);
    if (amountUnits > Number.MAX_SAFE_INTEGER / 100) throw new Error("階梯門檻金額過大。 ");
    return [{ minMonthlySalesCents: amountUnits * 100, rateBps: integer(rate, `第 ${index + 1} 階費率`) }];
  });
  const uplineRates = values(formData, "uplineBonusRateBps");
  const uplineLevels = uplineRates.flatMap((rate, index) => rate
    ? [{ level: index + 1, bonusRateBps: integer(rate, `第 ${index + 1} 層團隊長獎金`, 1) }]
    : []);
  const rule = parseCommissionRule({
    maxTotalRateBps: integer(formData.get("maxTotalRateBps"), "總分潤上限", 1),
    tiers,
    uplineLevels,
  });
  return { currency, ...rule };
}
