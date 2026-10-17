import { z } from "zod";
import { createMetricVisitorProofService } from "./live-metric-visitor-proof";

const Key = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/), key: z.string().regex(/^[0-9a-f]{64}$/) }).strict();
const Ring = z.object({ current: Key, previous: z.array(Key).max(2).optional() }).strict();

/** Dedicated provider/process injection only. Never generate a fallback key or
 * log configuration, parser errors, or key bytes. No dotenv/secret-store reads.
 */
export function metricVisitorProofsFromConfig(value: string | undefined) {
  if (!value || value.length > 2048) return null;
  try {
    const parsed = Ring.safeParse(JSON.parse(value));
    if (!parsed.success) return null;
    const decode = (entry: z.infer<typeof Key>) => ({ id: entry.id, key: Buffer.from(entry.key, "hex") });
    return createMetricVisitorProofService({ current: decode(parsed.data.current), previous: parsed.data.previous?.map(decode) });
  } catch { return null; }
}
