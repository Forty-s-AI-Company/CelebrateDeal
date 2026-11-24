import { describe, expect, it } from "vitest";
import { payUniResultRows as appResultRows } from "@/lib/payment-providers/payuni";

// A4-05 (run 45376157147): the lost-callback drill read only `Result` while the
// application also reads PayUni's bracket-encoded Result[0][Field] fields, so
// the drill saw no rows for a paid trade. Both readers now share one fixture
// table: every decrypted query payload must give the same row count and the
// same MerTradeNo per row on both sides. Synthetic values only.
const ORDER = "CDPARITY0001";
const OTHER = "CDPARITY0002";
const row = (merTradeNo: string, tradeNo = "SYNTHTRADE1") => ({ MerTradeNo: merTradeNo, TradeNo: tradeNo, TradeStatus: "1" });

/** Decrypted payloads exactly as `Object.fromEntries(new URLSearchParams(plaintext))` produces them (plus parsed objects). */
const FIXTURES: Array<[string, Record<string, unknown>]> = [
  ["no Result at all", { Status: "SUCCESS" }],
  ["Result as an array", { Status: "SUCCESS", Result: [row(ORDER), row(OTHER, "SYNTHTRADE2")] }],
  ["Result as an object", { Status: "SUCCESS", Result: row(ORDER) }],
  ["Result as a JSON object string", { Status: "SUCCESS", Result: JSON.stringify(row(ORDER)) }],
  ["Result as a JSON array string", { Status: "SUCCESS", Result: JSON.stringify([row(ORDER), row(OTHER, "SYNTHTRADE2")]) }],
  ["Result as a query string", { Status: "SUCCESS", Result: new URLSearchParams(row(ORDER)).toString() }],
  ["one indexed bracket row", { Status: "SUCCESS", "Result[0][MerTradeNo]": ORDER, "Result[0][TradeNo]": "SYNTHTRADE1", "Result[0][TradeStatus]": "1" }],
  ["one unindexed bracket row", { Status: "SUCCESS", "Result[MerTradeNo]": ORDER, "Result[TradeNo]": "SYNTHTRADE1" }],
  ["two bracket rows out of order", { Status: "SUCCESS", "Result[1][MerTradeNo]": OTHER, "Result[0][MerTradeNo]": ORDER, "Result[1][TradeNo]": "SYNTHTRADE2" }],
  ["bracket row without MerTradeNo", { Status: "SUCCESS", "Result[0][TradeNo]": "SYNTHTRADE1", "Result[0][TradeStatus]": "1" }],
  ["nested or foreign bracket keys only", { Status: "SUCCESS", "Result[0][Card][MerTradeNo]": ORDER, "Other[0][MerTradeNo]": ORDER }],
  ["a sparse bracket index", { Status: "SUCCESS", "Result[2][MerTradeNo]": ORDER }],
];

function shape(rows: unknown[]) {
  return {
    count: rows.length,
    merTradeNos: rows.map((entry) => (entry && typeof entry === "object" ? (entry as Record<string, unknown>).MerTradeNo ?? null : null)),
  };
}

describe("PayUni query Result reader parity (A4-05)", () => {
  it.each(FIXTURES)("%s: the drill and the application read the same rows", async (_name, payload) => {
    const { payUniResultRows: drillResultRows } = await import("./payuni-lost-callback-drill.mjs");
    const drill = drillResultRows(payload) as { rows: unknown[]; shape: string };
    expect(shape(drill.rows)).toEqual(shape(appResultRows(payload)));
  });

  it("the bracket fixtures really are read as rows by both (the run 45376157147 shape)", async () => {
    const { payUniResultRows: drillResultRows } = await import("./payuni-lost-callback-drill.mjs");
    const payload = Object.fromEntries(FIXTURES)["one indexed bracket row"]!;
    expect(drillResultRows(payload)).toMatchObject({ shape: "BRACKET_FIELDS", rows: [{ MerTradeNo: ORDER }] });
    expect(appResultRows(payload)).toEqual([{ MerTradeNo: ORDER, TradeNo: "SYNTHTRADE1", TradeStatus: "1" }]);
  });
});
