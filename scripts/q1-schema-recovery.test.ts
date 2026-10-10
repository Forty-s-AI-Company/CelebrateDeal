import { expect, it, vi } from "vitest";
import { originalProviderMatches, postSchemaRecovery, SCHEMA_RECOVERY_SOURCE } from "./q1-schema-recovery";

const signed = { MerTradeNo: "synthetic-original-order", TradeNo: "synthetic-original-trade", TradeStatus: "1", TradeAmt: 1 };
it("requires the newly signed paid query to match the original merchant and provider references", () => {
  expect(originalProviderMatches(signed, signed.MerTradeNo, signed.TradeNo)).toBe(true);
  expect(originalProviderMatches({ ...signed, TradeNo: undefined, TradeNoRef: signed.TradeNo }, signed.MerTradeNo, signed.TradeNo)).toBe(true);
});
it.each([{ MerTradeNo: "replacement" }, { TradeNo: "replacement" }, { TradeNoRef: "replacement" },
  { TradeAmt: 2 }, { TradeStatus: "0" }, { TradeNo: undefined }, { TradeNo: 123 }])("rejects changed signed original identity/state %#", drift => {
  expect(originalProviderMatches({ ...signed, ...drift }, signed.MerTradeNo, signed.TradeNo)).toBe(false);
});
it("persists possible effects before a single fixed POST with no caller-selected references", async () => {
  const reserve = vi.fn().mockResolvedValue(undefined);
  const request = vi.fn<typeof fetch>(async () => {
    expect(reserve).toHaveBeenCalledOnce();
    return new Response(JSON.stringify({ status: "PROCESSED", retryAttempts: 1, failureCode: "NONE" }));
  });
  await postSchemaRecovery("synthetic-job", request, reserve);
  expect(request).toHaveBeenCalledOnce();
  expect(request.mock.calls[0]![0]).toBe("https://celebrate-deal-staging.carry-digital-nomad.in.net/api/admin/ops/payuni/q1-original-schema-recovery");
  expect(request.mock.calls[0]![1]).toMatchObject({ method: "POST", redirect: "error",
    headers: { "x-celebratedeal-source-sha": SCHEMA_RECOVERY_SOURCE } });
  expect(request.mock.calls[0]![1]).not.toHaveProperty("body");
});
it("does not POST if durable receipt reservation fails", async () => {
  const request = vi.fn();
  await expect(postSchemaRecovery("synthetic-job", request, async () => { throw new Error("synthetic write failure"); })).rejects.toThrow();
  expect(request).not.toHaveBeenCalled();
});
it.each(["lost", "failed", "shape"])("never retries uncertain or failed %s transport", async kind => {
  const request = vi.fn(async () => {
    if (kind === "lost") throw new Error("synthetic network failure");
    return new Response(JSON.stringify(kind === "shape" ? { status: "PROCESSED", retryAttempts: 1, failureCode: "NONE", extra: true }
      : { status: "RETRY_FAILED", retryAttempts: 1, failureCode: "processing_failed" }));
  });
  await expect(postSchemaRecovery("synthetic-job", request)).rejects.toThrow();
  expect(request).toHaveBeenCalledOnce();
});
