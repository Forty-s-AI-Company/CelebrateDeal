import { z } from "zod";
import { parseMerchantAffiliateTerms } from "./affiliate-tier-policy";

function text(value: FormDataEntryValue | null) {
  return z.string().max(191).parse(value);
}
function integer(value: FormDataEntryValue | null) {
  const input = text(value);
  if (!/^\d{1,10}$/u.test(input)) throw new Error("件數與版本必須是非負整數。");
  return z.number().int().nonnegative().max(2147483647).parse(Number(input));
}
function percent(value: FormDataEntryValue | null) {
  const input = text(value);
  if (!/^\d{1,3}(?:\.\d{1,2})?$/u.test(input)) throw new Error("佣金比例最多保留兩位小數。");
  const [whole, fraction = ""] = input.split(".");
  return z.number().int().min(0).max(10000).parse(Number(whole) * 100 + Number(fraction.padEnd(2, "0")));
}

/** Parse bounded parallel fields; never silently drop malformed or extra rows. */
export function merchantAffiliatePolicyFromForm(form: FormData) {
  const starts = form.getAll("tierStart"), ends = form.getAll("tierEnd"), rates = form.getAll("tierRate");
  const uplines = form.getAll("uplineRate"), products = form.getAll("overrideProduct"), overrides = form.getAll("overrideRate");
  if (starts.length < 1 || starts.length > 32 || starts.length !== ends.length || starts.length !== rates.length || uplines.length > 8 || products.length > 200 || products.length !== overrides.length) throw new Error("佣金設定列數不一致或超出上限。");
  const terms = parseMerchantAffiliateTerms({ schemaVersion: 1, currency: "TWD", maxTotalBps: percent(form.get("maxTotalPercent")),
    tiers: starts.map((start, index) => ({ minQuantity: integer(start), maxQuantity: ends[index] === "" ? null : integer(ends[index]!), rateBps: percent(rates[index]!) })),
    uplines: uplines.map((rate, index) => ({ level: index + 1, rateBps: percent(rate) })),
    productOverrides: products.map((product, index) => ({ productId: text(product), rateBps: percent(overrides[index]!) })) });
  return { terms, expectedRevision: integer(form.get("expectedRevision")) };
}

export function merchantAffiliateRevisionFromForm(form: FormData) {
  return integer(form.get("expectedRevision"));
}
