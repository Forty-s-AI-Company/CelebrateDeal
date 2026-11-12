/**
 * 聯盟佣金政策表單的瀏覽器端草稿：百分比顯示、送出值、欄位層級錯誤與佣金試算。
 *
 * 伺服器欄位名稱與解析（`merchant-affiliate-policy-form.ts`）、驗證（`parseMerchantAffiliateTerms`）
 * 與佣金計算（`calculateMerchantAffiliatePlan`）都不在這裡改動。這個檔案只負責：
 * - 把使用者輸入的百分比文字換成伺服器收的百分比字串（`percent-bps.ts`，整數運算、不四捨五入）；
 * - 依與伺服器相同的規則找出「哪一列、哪一格」有問題，讓表單能標到具體欄位；
 * - 試算直接呼叫伺服器使用的 `calculateMerchantAffiliatePlan`，捨入方式因此完全相同。
 */
import { calculateMerchantAffiliatePlan, parseMerchantAffiliateTerms, type MerchantAffiliateTerms } from "./affiliate-tier-policy";
import { bpsToPercentText, parsePercentText, percentTextToPercentWire } from "./percent-bps";

export const MAX_POLICY_TIERS = 32;
export const MAX_POLICY_UPLINES = 8;
export const MAX_POLICY_OVERRIDES = 200;
/** 伺服器 `Bps` 上限：100%。 */
export const MAX_POLICY_RATE_BPS = 10_000;
const MAX_QUANTITY = 2_147_483_647;

export type PolicyTierDraft = { minQuantity: string; maxQuantity: string; ratePercent: string };
export type PolicyUplineDraft = { ratePercent: string };
export type PolicyOverrideDraft = { uiId: number; productId: string; ratePercent: string };
export type MerchantAffiliatePolicyDraft = {
  maxTotalPercent: string;
  tiers: PolicyTierDraft[];
  uplines: PolicyUplineDraft[];
  overrides: PolicyOverrideDraft[];
};

/** 已發布的政策（或預設值）→ 表單草稿。比例一律以最短百分比文字顯示。 */
export function draftFromTerms(terms: MerchantAffiliateTerms | null): MerchantAffiliatePolicyDraft {
  return {
    maxTotalPercent: bpsToPercentText(terms?.maxTotalBps ?? 10_000),
    tiers: (terms?.tiers ?? [{ minQuantity: 1, maxQuantity: null, rateBps: 1000 }]).map(tier => ({
      minQuantity: String(tier.minQuantity), maxQuantity: tier.maxQuantity === null ? "" : String(tier.maxQuantity), ratePercent: bpsToPercentText(tier.rateBps),
    })),
    uplines: (terms?.uplines ?? []).map(level => ({ ratePercent: bpsToPercentText(level.rateBps) })),
    overrides: (terms?.productOverrides ?? []).map((item, index) => ({ uiId: index, productId: item.productId, ratePercent: bpsToPercentText(item.rateBps) })),
  };
}

/** 欄位鍵：同時用在 `FormErrorSummary` 的 errors、欄位旁訊息與 `data-policy-field`。 */
export const policyFieldKey = {
  maxTotal: () => "maxTotalPercent",
  tierStart: (index: number) => `tierStart-${index}`,
  tierEnd: (index: number) => `tierEnd-${index}`,
  tierRate: (index: number) => `tierRate-${index}`,
  uplineRate: (index: number) => `uplineRate-${index}`,
  overrideProduct: (uiId: number) => `overrideProduct-u${uiId}`,
  overrideRate: (uiId: number) => `overrideRate-u${uiId}`,
};

export type PolicyFieldError = { label: string; message: string };

export const POLICY_RATE_MESSAGE = "請填 0 到 100 的數字，最多兩位小數。";

function rateBps(text: string): number | null {
  const parsed = parsePercentText(text);
  return parsed.kind === "ok" && parsed.bps <= MAX_POLICY_RATE_BPS ? parsed.bps : null;
}

/** 與伺服器 `integer()` 相同：1 到 10 位 ASCII 數字、不超過 2147483647；件數另外至少 1。 */
export function parsePolicyQuantity(text: string): number | null {
  if (!/^\d{1,10}$/u.test(text)) return null;
  const value = Number(text);
  return value >= 1 && value <= MAX_QUANTITY ? value : null;
}

/**
 * 依伺服器的規則（`merchantAffiliatePolicyFromForm` 加 `parseMerchantAffiliateTerms`）逐欄檢查，回傳
 * 「欄位鍵 → 錯誤」；空物件代表伺服器會接受（商品是否屬於這個商家仍由伺服器檢查）。
 * 鍵的順序就是畫面順序，`FormErrorSummary` 依此列出。`policy-draft` 測試以大量隨機草稿比對兩邊結果一致。
 */
export function validatePolicyDraft(draft: MerchantAffiliatePolicyDraft): Record<string, PolicyFieldError> {
  const errors: Record<string, PolicyFieldError> = {};
  const maxTotal = rateBps(draft.maxTotalPercent);
  if (maxTotal === null) errors[policyFieldKey.maxTotal()] = { label: "佣金總比例上限", message: POLICY_RATE_MESSAGE };

  const tierCount = draft.tiers.length;
  draft.tiers.forEach((tier, index) => {
    const name = `第 ${index + 1} 階`;
    const start = parsePolicyQuantity(tier.minQuantity);
    const isLast = index === tierCount - 1;
    if (start === null) errors[policyFieldKey.tierStart(index)] = { label: `${name}起始件數`, message: "請填 1 以上的整數。" };
    else if (index === 0 && start !== 1) errors[policyFieldKey.tierStart(index)] = { label: `${name}起始件數`, message: "第一階必須從第 1 件開始。" };
    else if (index > 0) {
      const previousEnd = parsePolicyQuantity(draft.tiers[index - 1]!.maxQuantity);
      if (previousEnd !== null && start !== previousEnd + 1) errors[policyFieldKey.tierStart(index)] = { label: `${name}起始件數`, message: `要接續上一階，填 ${previousEnd + 1}。` };
    }
    if (isLast) {
      if (tier.maxQuantity !== "") errors[policyFieldKey.tierEnd(index)] = { label: `${name}結束件數`, message: "最後一階的結束件數要留空。" };
    } else {
      const end = parsePolicyQuantity(tier.maxQuantity);
      if (tier.maxQuantity === "") errors[policyFieldKey.tierEnd(index)] = { label: `${name}結束件數`, message: "除了最後一階，都要填結束件數。" };
      else if (end === null) errors[policyFieldKey.tierEnd(index)] = { label: `${name}結束件數`, message: "請填 1 以上的整數。" };
      else if (start !== null && end < start) errors[policyFieldKey.tierEnd(index)] = { label: `${name}結束件數`, message: "結束件數不可小於起始件數。" };
    }
    if (rateBps(tier.ratePercent) === null) errors[policyFieldKey.tierRate(index)] = { label: `${name}直接佣金`, message: POLICY_RATE_MESSAGE };
  });

  draft.uplines.forEach((level, index) => {
    if (rateBps(level.ratePercent) === null) errors[policyFieldKey.uplineRate(index)] = { label: `第 ${index + 1} 層佣金`, message: POLICY_RATE_MESSAGE };
  });

  const seen = new Set<string>();
  draft.overrides.forEach((override, index) => {
    const name = `商品 ${index + 1}`;
    if (override.productId.trim() === "" || override.productId.length > 191) errors[policyFieldKey.overrideProduct(override.uiId)] = { label: `佣金${name}`, message: "請選擇商品。" };
    else if (seen.has(override.productId.trim())) errors[policyFieldKey.overrideProduct(override.uiId)] = { label: `佣金${name}`, message: "同一商品只能設定一次。" };
    seen.add(override.productId.trim());
    if (rateBps(override.ratePercent) === null) errors[policyFieldKey.overrideRate(override.uiId)] = { label: `${name}佣金`, message: POLICY_RATE_MESSAGE };
  });

  // 伺服器的總額檢查：最高直接佣金（階梯或商品）加上所有上線層級，不可超過總上限。
  const direct = [...draft.tiers.map(tier => rateBps(tier.ratePercent)), ...draft.overrides.map(item => rateBps(item.ratePercent))];
  const uplines = draft.uplines.map(level => rateBps(level.ratePercent));
  if (maxTotal !== null && direct.every(value => value !== null) && uplines.every(value => value !== null)) {
    const maximumDirect = Math.max(...(direct as number[]));
    const uplineTotal = (uplines as number[]).reduce((sum, value) => sum + value, 0);
    if (maximumDirect + uplineTotal > maxTotal) {
      // 總上限欄位在畫面最上方，錯誤也排在摘要第一個。
      return { [policyFieldKey.maxTotal()]: { label: "佣金總比例上限", message: `最高直接佣金 ${bpsToPercentText(maximumDirect)}% 加上線合計 ${bpsToPercentText(uplineTotal)}%，超過上限 ${bpsToPercentText(maxTotal)}%。` }, ...errors };
    }
  }
  return errors;
}

/** 表單實際送出的欄位與值（順序同 DOM）。元件以同一組換算產生隱藏欄位，測試用它比對伺服器解析結果。 */
export function policyDraftWireEntries(draft: MerchantAffiliatePolicyDraft): Array<[string, string]> {
  return [
    ["maxTotalPercent", percentTextToPercentWire(draft.maxTotalPercent)],
    ...draft.tiers.flatMap((tier): Array<[string, string]> => [["tierStart", tier.minQuantity], ["tierEnd", tier.maxQuantity], ["tierRate", percentTextToPercentWire(tier.ratePercent)]]),
    ...draft.uplines.map((level): [string, string] => ["uplineRate", percentTextToPercentWire(level.ratePercent)]),
    ...draft.overrides.flatMap((item): Array<[string, string]> => [["overrideProduct", item.productId], ["overrideRate", percentTextToPercentWire(item.ratePercent)]]),
  ];
}

/** 草稿 → 伺服器會儲存的條款；任一欄位不合法或違反政策規則時回傳 null（試算不顯示數字）。 */
export function draftToTerms(draft: MerchantAffiliatePolicyDraft): MerchantAffiliateTerms | null {
  if (Object.keys(validatePolicyDraft(draft)).length) return null;
  try {
    return parseMerchantAffiliateTerms({
      schemaVersion: 1, currency: "TWD", maxTotalBps: rateBps(draft.maxTotalPercent),
      tiers: draft.tiers.map(tier => ({ minQuantity: parsePolicyQuantity(tier.minQuantity), maxQuantity: tier.maxQuantity === "" ? null : parsePolicyQuantity(tier.maxQuantity), rateBps: rateBps(tier.ratePercent) })),
      uplines: draft.uplines.map((level, index) => ({ level: index + 1, rateBps: rateBps(level.ratePercent) })),
      productOverrides: draft.overrides.map(item => ({ productId: item.productId, rateBps: rateBps(item.ratePercent) })),
    });
  } catch {
    return null;
  }
}

/** 試算用的商品 ID：不會與真實商品（cuid）重複，所以不套用任何商品佣金。 */
export const ESTIMATE_NO_PRODUCT_ID = "試算-未指定商品";
/** 伺服器單次計算的件數上限（`calculateMerchantAffiliatePlan`）。 */
export const MAX_ESTIMATE_QUANTITY = 1000;
const MAX_CENTS = 2_147_483_647;

export type CommissionEstimateInput = { quantity: string; unitPrice: string; soldBefore: string; productId: string };
export type CommissionEstimate =
  | { kind: "invalid-policy" }
  | { kind: "invalid-input"; field: "quantity" | "unitPrice" | "soldBefore"; message: string }
  | { kind: "ok"; plan: ReturnType<typeof calculateMerchantAffiliatePlan> };

/** 新台幣金額文字 → 分（整數運算）：最多 9 位整數、2 位小數。 */
export function twdTextToCents(text: string): number | null {
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/u.exec(text);
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

/**
 * 「賣 N 件、單價 X 元」的佣金試算。直接呼叫伺服器結算時使用的 `calculateMerchantAffiliatePlan`：
 * 視為同一筆付款、所有上線層級都有人，件數從 `soldBefore` 之後開始累計。
 */
export function estimateMerchantAffiliateCommission(terms: MerchantAffiliateTerms | null, input: CommissionEstimateInput): CommissionEstimate {
  if (!terms) return { kind: "invalid-policy" };
  if (!/^\d{1,4}$/u.test(input.quantity) || Number(input.quantity) < 1 || Number(input.quantity) > MAX_ESTIMATE_QUANTITY) {
    return { kind: "invalid-input", field: "quantity", message: `件數請填 1 到 ${MAX_ESTIMATE_QUANTITY} 的整數。` };
  }
  const unitCents = twdTextToCents(input.unitPrice);
  if (unitCents === null) return { kind: "invalid-input", field: "unitPrice", message: "單價請填金額，最多兩位小數。" };
  const quantityValue = Number(input.quantity);
  const grossCents = unitCents * quantityValue;
  if (grossCents > MAX_CENTS) return { kind: "invalid-input", field: "unitPrice", message: "單筆金額超過結算上限，請降低單價或件數。" };
  if (!/^(?:0|[1-9]\d{0,14})$/u.test(input.soldBefore)) return { kind: "invalid-input", field: "soldBefore", message: "已累計件數請填 0 以上的整數。" };
  const recipients = [{ affiliateId: "試算-推廣者", level: 0 }, ...terms.uplines.map(level => ({ affiliateId: `試算-第${level.level}層`, level: level.level }))];
  try {
    const plan = calculateMerchantAffiliatePlan({
      terms, recipients, qualifiedQuantityBefore: input.soldBefore, netReferenceAmountCents: grossCents,
      lines: [{ productId: input.productId || ESTIMATE_NO_PRODUCT_ID, quantity: quantityValue, amountCents: grossCents }],
    });
    return { kind: "ok", plan };
  } catch {
    // 前面已擋下件數、金額與總上限；伺服器函式仍拒絕時只說無法試算，不顯示任何數字。
    return { kind: "invalid-policy" };
  }
}

/** 把逐件套用的比例合併成「第 a–b 件：r%」的區段，供試算說明。 */
export function summarizeEstimateRates(plan: ReturnType<typeof calculateMerchantAffiliatePlan>) {
  const segments: Array<{ from: string; to: string; rateBps: number }> = [];
  for (const unit of plan.selectedTiers) {
    const last = segments.at(-1);
    if (last && last.rateBps === unit.rateBps && BigInt(last.to) + BigInt(1) === BigInt(unit.qualifiedQuantity)) last.to = unit.qualifiedQuantity;
    else segments.push({ from: unit.qualifiedQuantity, to: unit.qualifiedQuantity, rateBps: unit.rateBps });
  }
  return segments;
}
