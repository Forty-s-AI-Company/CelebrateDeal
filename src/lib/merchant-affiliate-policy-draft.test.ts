import { describe, expect, it } from "vitest";
import { calculateMerchantAffiliatePlan } from "./affiliate-tier-policy";
import { merchantAffiliatePolicyFromForm } from "./merchant-affiliate-policy-form";
import { bpsToPercentText } from "./percent-bps";
import {
  draftFromTerms, draftToTerms, ESTIMATE_NO_PRODUCT_ID, estimateMerchantAffiliateCommission, policyDraftWireEntries, summarizeEstimateRates, twdTextToCents, validatePolicyDraft,
  type CommissionEstimateInput, type MerchantAffiliatePolicyDraft,
} from "./merchant-affiliate-policy-draft";

/** 表單實際送出的 FormData（與元件的欄位順序相同），交給伺服器的解析函式。 */
function serverParse(draft: MerchantAffiliatePolicyDraft) {
  const form = new FormData();
  form.append("expectedRevision", "0");
  for (const [name, value] of policyDraftWireEntries(draft)) form.append(name, value);
  try { return { ok: true as const, terms: merchantAffiliatePolicyFromForm(form).terms }; } catch (error) { return { ok: false as const, error }; }
}

function draft(partial: Partial<MerchantAffiliatePolicyDraft> = {}): MerchantAffiliatePolicyDraft {
  return { maxTotalPercent: "100", tiers: [{ minQuantity: "1", maxQuantity: "", ratePercent: "10" }], uplines: [], overrides: [], ...partial };
}

/** 固定種子的亂數，失敗時可重現。 */
function mulberry32(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("送出值與伺服器解析一致", () => {
  it("0 到 10000 每一個 bps：顯示文字經表單送出後，伺服器解析出同一個 bps", () => {
    for (let bps = 0; bps <= 10_000; bps += 1) {
      const result = serverParse(draft({ tiers: [{ minQuantity: "1", maxQuantity: "", ratePercent: bpsToPercentText(bps) }] }));
      if (!result.ok || result.terms.tiers[0]!.rateBps !== bps) throw new Error(`bps ${bps} 送出後不一致`);
    }
  }, 60_000);

  it.each([
    [".5", 50], ["0020", 2000], ["00.01", 1], ["012.3", 1230], ["100", 10_000], ["0", 0],
  ])("寬鬆輸入 %j 正規化後伺服器得到 %i bps", (text, bps) => {
    const result = serverParse(draft({ tiers: [{ minQuantity: "1", maxQuantity: "", ratePercent: text }] }));
    expect(result.ok && result.terms.tiers[0]!.rateBps).toBe(bps);
  });

  it.each(["", "12.345", "100.01", "150", "-1", "1e1", "１２", " 12", "abc", "."])("不合法的 %j：用戶端標錯，伺服器也必定拒絕（不會變成另一個合法比例）", (text) => {
    for (const field of ["maxTotal", "tier", "upline", "override"] as const) {
      const value = draft({
        maxTotalPercent: field === "maxTotal" ? text : "100",
        tiers: [{ minQuantity: "1", maxQuantity: "", ratePercent: field === "tier" ? text : "10" }],
        uplines: field === "upline" ? [{ ratePercent: text }] : [],
        overrides: field === "override" ? [{ uiId: 0, productId: "p1", ratePercent: text }] : [],
      });
      expect(Object.keys(validatePolicyDraft(value)).length).toBeGreaterThan(0);
      expect(serverParse(value).ok).toBe(false);
    }
  });

  it("已發布的條款載入草稿後原樣送回", () => {
    const terms = { schemaVersion: 1 as const, currency: "TWD" as const, maxTotalBps: 3333, tiers: [{ minQuantity: 1, maxQuantity: 9, rateBps: 1005 }, { minQuantity: 10, maxQuantity: null, rateBps: 1050 }], uplines: [{ level: 1, rateBps: 1 }, { level: 2, rateBps: 99 }], productOverrides: [{ productId: "p1", rateBps: 2050 }] };
    const loaded = draftFromTerms(terms);
    expect(loaded.tiers.map(tier => tier.ratePercent)).toEqual(["10.05", "10.5"]);
    expect(loaded.maxTotalPercent).toBe("33.33");
    const result = serverParse(loaded);
    expect(result.ok && result.terms).toEqual(terms);
    expect(draftToTerms(loaded)).toEqual(terms);
  });
});

describe("欄位錯誤定位到具體列", () => {
  it("階梯不連續：標在第 3 階起始件數", () => {
    const errors = validatePolicyDraft(draft({ tiers: [
      { minQuantity: "1", maxQuantity: "10", ratePercent: "10" },
      { minQuantity: "11", maxQuantity: "20", ratePercent: "12" },
      { minQuantity: "22", maxQuantity: "", ratePercent: "15" },
    ] }));
    expect(errors).toEqual({ "tierStart-2": { label: "第 3 階起始件數", message: "要接續上一階，填 21。" } });
  });

  it("最後一階有結束件數、中間一階缺結束件數、結束小於起始", () => {
    expect(validatePolicyDraft(draft({ tiers: [{ minQuantity: "1", maxQuantity: "5", ratePercent: "10" }] }))).toHaveProperty("tierEnd-0.message", "最後一階的結束件數要留空。");
    expect(validatePolicyDraft(draft({ tiers: [{ minQuantity: "1", maxQuantity: "", ratePercent: "10" }, { minQuantity: "2", maxQuantity: "", ratePercent: "10" }] }))).toHaveProperty("tierEnd-0.message", "除了最後一階，都要填結束件數。");
    expect(validatePolicyDraft(draft({ tiers: [{ minQuantity: "1", maxQuantity: "5", ratePercent: "10" }, { minQuantity: "6", maxQuantity: "4", ratePercent: "10" }, { minQuantity: "5", maxQuantity: "", ratePercent: "10" }] }))).toHaveProperty("tierEnd-1.message", "結束件數不可小於起始件數。");
  });

  it("商品重複與未選：以列的 uiId 標示", () => {
    const errors = validatePolicyDraft(draft({ overrides: [{ uiId: 4, productId: "p1", ratePercent: "5" }, { uiId: 9, productId: "p1", ratePercent: "5" }, { uiId: 11, productId: "", ratePercent: "5" }] }));
    expect(Object.keys(errors)).toEqual(["overrideProduct-u9", "overrideProduct-u11"]);
    expect(errors["overrideProduct-u9"]!.label).toBe("佣金商品 2");
  });

  it("超過總上限：標在總上限欄位，並排在第一個", () => {
    const errors = validatePolicyDraft(draft({ maxTotalPercent: "20", tiers: [{ minQuantity: "1", maxQuantity: "", ratePercent: "15" }], uplines: [{ ratePercent: "3" }, { ratePercent: "2.01" }], overrides: [{ uiId: 0, productId: "", ratePercent: "1" }] }));
    expect(Object.keys(errors)).toEqual(["maxTotalPercent", "overrideProduct-u0"]);
    expect(errors.maxTotalPercent!.message).toBe("最高直接佣金 15% 加上線合計 5.01%，超過上限 20%。");
  });
});

describe("用戶端檢查與伺服器驗證對大量隨機草稿結果一致", () => {
  const rates = ["0", "10", "12.34", ".5", "0020", "5", "1", "100", "100.01", "150", "12.345", "", "-1", "1e1", "１"];
  const quantities = ["0", "", "abc", "1.5", "1e1", "2147483648", "99999999999", "-1"];
  it("8000 組草稿：validatePolicyDraft 無錯誤 ⇔ 伺服器接受，且條款相同", () => {
    const random = mulberry32(20261112);
    const pick = <T,>(items: readonly T[]) => items[Math.floor(random() * items.length)]!;
    let accepted = 0, rejected = 0;
    for (let round = 0; round < 8000; round += 1) {
      const tierCount = 1 + Math.floor(random() * 4);
      const tiers = [];
      let start = 1;
      for (let index = 0; index < tierCount; index += 1) {
        const last = index === tierCount - 1;
        const end = start + Math.floor(random() * 5);
        tiers.push({
          minQuantity: random() < 0.08 ? pick(quantities) : random() < 0.05 ? String(start + 1) : String(start),
          maxQuantity: random() < 0.08 ? pick(quantities) : last ? (random() < 0.05 ? String(end) : "") : (random() < 0.05 ? String(start - 1) : String(end)),
          ratePercent: random() < 0.15 ? pick(rates) : String(Math.floor(random() * 20)),
        });
        start = end + 1;
      }
      const value: MerchantAffiliatePolicyDraft = {
        maxTotalPercent: random() < 0.1 ? pick(rates) : pick(["100", "50", "30", "25.5"]),
        tiers,
        uplines: Array.from({ length: Math.floor(random() * 4) }, () => ({ ratePercent: random() < 0.15 ? pick(rates) : String(Math.floor(random() * 8)) })),
        overrides: Array.from({ length: Math.floor(random() * 4) }, (_, uiId) => ({ uiId, productId: pick(["p1", "p2", "p3", ""]), ratePercent: random() < 0.15 ? pick(rates) : String(Math.floor(random() * 20)) })),
      };
      const clientOk = Object.keys(validatePolicyDraft(value)).length === 0;
      const server = serverParse(value);
      if (clientOk !== server.ok) throw new Error(`第 ${round} 組不一致：${JSON.stringify(value)} client=${clientOk} server=${server.ok}`);
      if (server.ok) {
        accepted += 1;
        expect(draftToTerms(value)).toEqual(server.terms);
      } else {
        rejected += 1;
        expect(draftToTerms(value)).toBeNull();
      }
    }
    // 兩種結果都要有足夠樣本，否則這個比對沒有意義。
    expect(accepted).toBeGreaterThan(800);
    expect(rejected).toBeGreaterThan(800);
  }, 60_000);
});

describe("佣金試算重用伺服器的 calculateMerchantAffiliatePlan", () => {
  const twoTiers = draft({
    maxTotalPercent: "30",
    tiers: [{ minQuantity: "1", maxQuantity: "10", ratePercent: "10" }, { minQuantity: "11", maxQuantity: "", ratePercent: "20" }],
    uplines: [{ ratePercent: "5" }, { ratePercent: "2.5" }],
    overrides: [{ uiId: 0, productId: "p1", ratePercent: "15" }],
  });
  const input = (partial: Partial<CommissionEstimateInput>): CommissionEstimateInput => ({ quantity: "1", unitPrice: "100", soldBefore: "0", productId: "", ...partial });
  const amounts = (estimate: ReturnType<typeof estimateMerchantAffiliateCommission>) => {
    if (estimate.kind !== "ok") throw new Error(estimate.kind);
    return { levels: estimate.plan.recipients.map(recipient => recipient.amountCents), total: estimate.plan.commissionAmountCents };
  };

  it("跨階梯：先前 8 件，再賣 4 件、每件 NT$100 → 第 9–10 件 10%、第 11–12 件 20%", () => {
    const estimate = estimateMerchantAffiliateCommission(draftToTerms(twoTiers), input({ quantity: "4", soldBefore: "8" }));
    expect(amounts(estimate)).toEqual({ levels: [6000, 2000, 1000], total: 9000 });
    if (estimate.kind === "ok") expect(summarizeEstimateRates(estimate.plan)).toEqual([{ from: "9", to: "10", rateBps: 1000 }, { from: "11", to: "12", rateBps: 2000 }]);
  });

  it("商品佣金取代階梯直接佣金，上線比例不變", () => {
    expect(amounts(estimateMerchantAffiliateCommission(draftToTerms(twoTiers), input({ quantity: "2", productId: "p1" })))).toEqual({ levels: [3000, 1000, 500], total: 4500 });
  });

  it("捨入與伺服器相同：整筆四捨五入一次，餘數分給最大餘數", () => {
    const terms = draftToTerms(draft({ tiers: [{ minQuantity: "1", maxQuantity: "", ratePercent: "3.33" }], uplines: [{ ratePercent: "1.67" }] }));
    // 每件 NT$0.10：直接 3 × 10 × 333 = 9990、上線 3 × 10 × 167 = 5010，合計 (15000 + 5000) / 10000 = 2 分，各分 1 分。
    expect(amounts(estimateMerchantAffiliateCommission(terms, input({ quantity: "3", unitPrice: "0.1" })))).toEqual({ levels: [1, 1], total: 2 });
  });

  it("多組案例與「表單送出 → 伺服器解析 → 伺服器計算」逐分相同", () => {
    const random = mulberry32(7);
    const drafts = [twoTiers, draft({ maxTotalPercent: "100", tiers: [{ minQuantity: "1", maxQuantity: "3", ratePercent: "33.33" }, { minQuantity: "4", maxQuantity: "", ratePercent: "0.01" }], uplines: [{ ratePercent: "16.67" }, { ratePercent: "0.01" }, { ratePercent: "49.99" }] })];
    let compared = 0;
    for (const value of drafts) {
      const server = serverParse(value);
      if (!server.ok) throw new Error("fixture 應該是合法政策");
      for (let round = 0; round < 300; round += 1) {
        const trial = input({ quantity: String(1 + Math.floor(random() * 1000)), unitPrice: `${Math.floor(random() * 5000)}.${String(Math.floor(random() * 100)).padStart(2, "0")}`, soldBefore: String(Math.floor(random() * 20)), productId: random() < 0.3 ? "p1" : "" });
        const estimate = estimateMerchantAffiliateCommission(draftToTerms(value), trial);
        const grossCents = twdTextToCents(trial.unitPrice)! * Number(trial.quantity);
        const expected = calculateMerchantAffiliatePlan({
          terms: server.terms, qualifiedQuantityBefore: trial.soldBefore, netReferenceAmountCents: grossCents,
          recipients: [{ affiliateId: "a0", level: 0 }, ...server.terms.uplines.map(level => ({ affiliateId: `a${level.level}`, level: level.level }))],
          lines: [{ productId: trial.productId || ESTIMATE_NO_PRODUCT_ID, quantity: Number(trial.quantity), amountCents: grossCents }],
        });
        expect(amounts(estimate)).toEqual({ levels: expected.recipients.map(recipient => recipient.amountCents), total: expected.commissionAmountCents });
        compared += 1;
      }
    }
    expect(compared).toBe(600);
  });

  it("設定不合法時不試算；試算條件不合法時指出欄位", () => {
    expect(estimateMerchantAffiliateCommission(draftToTerms(draft({ maxTotalPercent: "5" })), input({})).kind).toBe("invalid-policy");
    const terms = draftToTerms(twoTiers);
    expect(estimateMerchantAffiliateCommission(terms, input({ quantity: "0" }))).toMatchObject({ kind: "invalid-input", field: "quantity" });
    expect(estimateMerchantAffiliateCommission(terms, input({ quantity: "1001" }))).toMatchObject({ kind: "invalid-input", field: "quantity" });
    expect(estimateMerchantAffiliateCommission(terms, input({ unitPrice: "100.005" }))).toMatchObject({ kind: "invalid-input", field: "unitPrice" });
    expect(estimateMerchantAffiliateCommission(terms, input({ unitPrice: "1e3" }))).toMatchObject({ kind: "invalid-input", field: "unitPrice" });
    expect(estimateMerchantAffiliateCommission(terms, input({ quantity: "1000", unitPrice: "21475" }))).toMatchObject({ kind: "invalid-input", field: "unitPrice" });
    expect(estimateMerchantAffiliateCommission(terms, input({ soldBefore: "-1" }))).toMatchObject({ kind: "invalid-input", field: "soldBefore" });
    expect(estimateMerchantAffiliateCommission(terms, input({ soldBefore: "01" }))).toMatchObject({ kind: "invalid-input", field: "soldBefore" });
  });

  it("twdTextToCents 用整數運算", () => {
    expect(twdTextToCents("0.29")).toBe(29);
    expect(twdTextToCents("1.1")).toBe(110);
    expect(twdTextToCents("999999999.99")).toBe(99_999_999_999);
    for (const text of ["", ".5", "1.", "-1", "1e2", "１"]) expect(twdTextToCents(text)).toBeNull();
  });
});
