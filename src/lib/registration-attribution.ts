import { z } from "zod";

// 只驗證傳遞格式；歸因資格與跨租戶檢查仍由提交 API 決定。
export const RegistrationAttributionSchema = z.object({
  referralCode: z.string().min(1).max(80).optional(),
  shareCode: z.string().regex(/^tls1\.[A-Za-z0-9_-]{32,155}$/u).max(160).optional(),
  landingPageId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u).optional(),
}).strict();
export type RegistrationAttribution = z.infer<typeof RegistrationAttributionSchema>;
export type RegistrationAttributionQuery = { ref?: string | string[]; share?: string | string[]; lp?: string | string[] };

/** 無效或重複 query 不建立來源聲明；原生與 JS 使用同一份 server metadata。 */
export function registrationAttribution(query: RegistrationAttributionQuery = {}): RegistrationAttribution {
  const result: RegistrationAttribution = {};
  const mappings = [["ref", "referralCode"], ["share", "shareCode"], ["lp", "landingPageId"]] as const;
  for (const [queryKey, field] of mappings) {
    const parsed = RegistrationAttributionSchema.shape[field].safeParse(query[queryKey]);
    if (parsed.success && parsed.data !== undefined) result[field] = parsed.data;
  }
  return result;
}

/** URLSearchParams 與 Next searchParams 對重複參數採相同的拒收規則。 */
export function registrationAttributionFromSearchParams(query: URLSearchParams): RegistrationAttribution {
  const scalar = (key: string) => {
    const values = query.getAll(key);
    return values.length === 1 ? values[0] : values;
  };
  return registrationAttribution({ ref: scalar("ref"), share: scalar("share"), lp: scalar("lp") });
}
