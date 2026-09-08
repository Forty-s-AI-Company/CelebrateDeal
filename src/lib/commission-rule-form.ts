import { parseCommissionRule } from "@/lib/commission-rule-engine";
import { parseTieredCommissionPolicy } from "@/lib/tiered-commission-engine";

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
  const overrideProductIds = values(formData, "overrideProductId");
  const overrideRates = values(formData, "overrideRateBps");
  if (overrideProductIds.length !== overrideRates.length) throw new Error("商品覆蓋與費率筆數不一致。 ");
  const productOverrides = overrideProductIds.flatMap((productId, index) => {
    const rate = overrideRates[index] ?? "";
    if (!rate) return [];
    if (!productId) throw new Error("商品覆蓋必須同時選擇商品與填寫費率。 ");
    return [{ productId, rateBps: integer(rate, `第 ${index + 1} 筆商品覆蓋費率`) }];
  });
  if (new Set(productOverrides.map((item) => item.productId)).size !== productOverrides.length) throw new Error("同一商品不可重複設定覆蓋率。 ");
  const rule = parseCommissionRule({
    maxTotalRateBps: integer(formData.get("maxTotalRateBps"), "總分潤上限", 1),
    tiers,
    uplineLevels,
  });
  const quantityMinimums = values(formData, "tierMinQuantity");
  const quantityRates = values(formData, "tierQuantityRateBps");
  const quantityTiers = quantityMinimums.length === 0 && quantityRates.length === 0
    ? []
    : parseTieredCommissionPolicy({
        version: 1,
        tiers: quantityMinimums.flatMap((minimum, index) => {
          const rate = quantityRates[index] ?? "";
          if (!minimum && !rate) return [];
          if (!minimum || !rate) throw new Error("每個件數階梯都必須同時填寫門檻與費率。 ");
          const minQuantity = integer(minimum, `第 ${index + 1} 階件數門檻`, 1);
          const nextMinimum = quantityMinimums.slice(index + 1).find((value) => value.length > 0);
          return [{
            minQuantity,
            maxQuantity: nextMinimum ? integer(nextMinimum, `第 ${index + 2} 階件數門檻`, 1) - 1 : null,
            rateBps: integer(rate, `第 ${index + 1} 階件數費率`),
          }];
        }),
      }).tiers;
  const uplineTotalBps = rule.uplineLevels.reduce((sum, item) => sum + item.bonusRateBps, 0);
  if (productOverrides.some((item) => item.rateBps + uplineTotalBps > rule.maxTotalRateBps)) {
    throw new Error("商品覆蓋費率加上團隊長獎金不得超過總分潤上限。 ");
  }
  return { currency, ...rule, quantityTiers, productOverrides };
}
