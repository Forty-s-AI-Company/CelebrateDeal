import { describe, expect, it } from "vitest";
import { bpsToPercentText, INVALID_PERCENT_PREFIX, parsePercentText, PERCENT_INPUT_PATTERN, percentTextToBpsWire, percentTextToPercentWire } from "./percent-bps";

/** 瀏覽器套用 `pattern` 的方式：整段比對（自動加 ^(?:…)$），新瀏覽器用 v flag。 */
const nativePattern = new RegExp(`^(?:${PERCENT_INPUT_PATTERN})$`, "v");

describe("parsePercentText", () => {
  it.each([
    ["0", 0], ["0.01", 1], ["0.1", 10], ["1", 100], ["12.34", 1234], ["12.5", 1250], ["99.99", 9999], ["100", 10_000],
    ["999.99", 99_999], [".5", 50], [".05", 5], ["05", 500], ["0020", 2000], ["000.5", 50], ["0000", 0],
  ])("%s → %i bps（不經浮點、不四捨五入）", (text, bps) => {
    expect(parsePercentText(text)).toEqual({ kind: "ok", bps });
  });

  it("0.29 換成 29，不是浮點的 28.999…", () => {
    expect(parsePercentText("0.29")).toEqual({ kind: "ok", bps: 29 });
    expect(parsePercentText("1.13")).toEqual({ kind: "ok", bps: 113 });
  });

  it("空字串是 empty，不是 0", () => {
    expect(parsePercentText("")).toEqual({ kind: "empty" });
  });

  it.each([
    "12.345", "0.001", "1000", "1234.5", "-1", "-0", "+1", "1e2", "1E2", "1e-2", "Infinity", "NaN", "abc", ".", "1.", "1..2",
    "1,5", "１２", "１2", "12．5", " 12", "12 ", " ", "0x10", "1_000",
  ])("%j 不合法（不四捨五入、不截斷）", (text) => {
    expect(parsePercentText(text)).toEqual({ kind: "invalid" });
  });
});

describe("PERCENT_INPUT_PATTERN 與換算器一致", () => {
  const samples = [
    "0", "0.01", "12.34", "100", "999.99", ".5", ".05", "05", "0020", "000.5", "0000",
    "12.345", "1000", "-1", "1e2", "Infinity", ".", "1.", "1,5", "１２", " 12", "12 ", "abc",
  ];
  it.each(samples)("%j：pattern 通過 ⇔ 換算成功", (text) => {
    expect(nativePattern.test(text)).toBe(parsePercentText(text).kind === "ok");
  });
});

describe("bpsToPercentText", () => {
  it.each([[0, "0"], [1, "0.01"], [10, "0.1"], [1005, "10.05"], [1050, "10.5"], [1234, "12.34"], [10_000, "100"], [99_999, "999.99"]])("%i → %s", (bps, text) => {
    expect(bpsToPercentText(bps)).toBe(text);
  });

  it("0 到 99999 每一個 bps 換成文字再換回來都相同", () => {
    for (let bps = 0; bps <= 99_999; bps += 1) {
      const parsed = parsePercentText(bpsToPercentText(bps));
      if (parsed.kind !== "ok" || parsed.bps !== bps) throw new Error(`round trip failed at ${bps}`);
    }
  });

  it("超過 99999 仍照位數換算（商品表單會把伺服器的原值顯示回去）", () => {
    expect(bpsToPercentText(123_456)).toBe("1234.56");
  });

  it.each([-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])("拒絕 %d", (bps) => {
    expect(() => bpsToPercentText(bps)).toThrow(RangeError);
  });
});

describe("送出值", () => {
  it("百分比欄位：合法值正規化、空白送空字串、其餘送 invalid:", () => {
    expect(percentTextToPercentWire(".5")).toBe("0.5");
    expect(percentTextToPercentWire("0020")).toBe("20");
    expect(percentTextToPercentWire("12.50")).toBe("12.5");
    expect(percentTextToPercentWire("150")).toBe("150");
    expect(percentTextToPercentWire("")).toBe("");
    expect(percentTextToPercentWire("12.345")).toBe(`${INVALID_PERCENT_PREFIX}12.345`);
    expect(percentTextToPercentWire("1e2")).toBe(`${INVALID_PERCENT_PREFIX}1e2`);
  });

  it("bps 欄位：合法值送整數；空白與不合法都送 invalid:（Number() 為 NaN，不會變成 0）", () => {
    expect(percentTextToBpsWire("12.34")).toBe("1234");
    expect(percentTextToBpsWire(".5")).toBe("50");
    expect(percentTextToBpsWire("0")).toBe("0");
    for (const text of ["", "12.345", "-1", "１２", "1e2"]) {
      const wire = percentTextToBpsWire(text);
      expect(wire.startsWith(INVALID_PERCENT_PREFIX)).toBe(true);
      expect(Number(wire)).toBeNaN();
      expect(Number(wire.trim())).toBeNaN();
    }
  });
});
