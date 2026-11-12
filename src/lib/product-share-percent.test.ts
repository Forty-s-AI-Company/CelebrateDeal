import { describe, expect, it } from "vitest";
import { bpsToPercentText, percentTextToBps, SHARE_PERCENT_INPUT_PATTERN } from "./product-share-percent";

describe("bpsToPercentText", () => {
  it.each([
    ["", ""],
    ["1", "0.01"],
    ["9", "0.09"],
    ["10", "0.1"],
    ["29", "0.29"],
    ["100", "1"],
    ["110", "1.1"],
    ["1234", "12.34"],
    ["2000", "20"],
    ["2050", "20.5"],
    ["9999", "99.99"],
    ["0", "0"],
    ["10000", "100"],
    ["invalid:20.005", "20.005"],
    ["abc", "abc"],
    ["20.5", "20.5"],
  ])("shows %j as %j", (bps, expected) => {
    expect(bpsToPercentText(bps)).toBe(expected);
  });
});

describe("percentTextToBps", () => {
  it.each([
    ["", ""],
    ["   ", ""],
    ["0.01", "1"],
    ["0.1", "10"],
    ["0.29", "29"],
    ["1.1", "110"],
    ["12.34", "1234"],
    ["20", "2000"],
    ["20.", "invalid:20."],
    [".5", "50"], [".05", "5"], [".99", "99"], ["0020", "2000"], ["00.5", "50"], ["0100", "10000"], ["000", "0"],
    [".", "invalid:."], ["0.", "invalid:0."], ["1000", "invalid:1000"], [".123", "invalid:.123"], ["2e1", "invalid:2e1"], ["+5", "invalid:+5"],
    ["20.5", "2050"],
    ["99.99", "9999"],
    [" 20 ", "2000"],
    // 超出伺服器範圍的整數照換算送出，由伺服器回報範圍錯誤。
    ["0", "0"],
    ["0.00", "0"],
    ["100", "10000"],
    ["100.01", "10001"],
    // 無法無損換算的輸入：不進位、不截斷，以伺服器必拒的值送出。
    ["20.005", "invalid:20.005"],
    ["0.001", "invalid:0.001"],
    ["1e3", "invalid:1e3"],
    ["-5", "invalid:-5"],
    ["abc", "invalid:abc"],
    ["1,5", "invalid:1,5"],
  ])("converts %j to %j", (percent, expected) => {
    expect(percentTextToBps(percent)).toBe(expected);
  });

  it("accepts exactly the same formats as the native input pattern", () => {
    const pattern = new RegExp(`^(?:${SHARE_PERCENT_INPUT_PATTERN})$`, "u");
    const samples = ["0", "1", "20", "0020", "100", "999", "1000", ".5", ".05", "0.5", "20.5", "20.55", "20.555", "20.", ".", "1e3", "2e1", "-5", "+5", "1,5", "abc", "1_0"];
    for (const sample of samples) {
      const convertible = !percentTextToBps(sample).startsWith("invalid:");
      expect(pattern.test(sample), sample).toBe(convertible);
    }
  });

  it("round-trips every valid server value without loss", () => {
    for (let bps = 1; bps <= 9_999; bps += 1) {
      expect(percentTextToBps(bpsToPercentText(String(bps)))).toBe(String(bps));
    }
  });

  it("never produces a value the server's integer parse would accept for unconvertible text", () => {
    for (const text of ["20.005", "1e3", "0x10", "-5", "abc", "1_000", "Infinity"]) {
      expect(Number.isInteger(Number(percentTextToBps(text)))).toBe(false);
    }
  });
});

describe("改用共用的 percent-bps 後行為不變", () => {
  // #584 合併時的原始實作，逐字保留作為比對基準。
  const legacyPattern = /^(\d*)(?:\.(\d{1,2}))?$/u;
  function legacyBpsToPercentText(bps: string): string {
    const text = bps.trim();
    if (text.startsWith("invalid:")) return text.slice("invalid:".length);
    if (!/^\d{1,9}$/u.test(text)) return text;
    const value = Number(text);
    const whole = Math.floor(value / 100);
    const fraction = value % 100;
    if (fraction === 0) return String(whole);
    return `${whole}.${String(fraction).padStart(2, "0").replace(/0$/u, "")}`;
  }
  function legacyPercentTextToBps(percent: string): string {
    const text = percent.trim();
    if (text === "") return "";
    const match = legacyPattern.exec(text);
    if (!match || (match[1] === "" && match[2] === undefined)) return `invalid:${text}`;
    const wholeDigits = (match[1] ?? "").replace(/^0+/u, "");
    if (wholeDigits.length > 3) return `invalid:${text}`;
    const whole = Number(wholeDigits || "0");
    const fraction = Number((match[2] ?? "").padEnd(2, "0"));
    return String(whole * 100 + fraction);
  }

  it("bps 0 到 120000 與各種字串的顯示結果相同", () => {
    for (let bps = 0; bps <= 120_000; bps += 1) {
      if (bpsToPercentText(String(bps)) !== legacyBpsToPercentText(String(bps))) throw new Error(`bps ${bps}`);
    }
    for (const text of ["", " ", " 123 ", "999999999", "1000000000", "-1", "1.5", "invalid:", "invalid:abc", " invalid:20.005 ", "abc", "０"]) {
      expect(bpsToPercentText(text)).toBe(legacyBpsToPercentText(text));
    }
  });

  it("百分比文字的換算結果相同", () => {
    const pieces = ["", "0", "00", "1", "12", "123", "1234", ".", ".5", ".55", ".555", "-", "+", "e", " ", "１", ","];
    for (const a of pieces) for (const b of pieces) for (const c of ["", " ", "0"]) {
      const text = `${a}${b}${c}`;
      expect(percentTextToBps(text), JSON.stringify(text)).toBe(legacyPercentTextToBps(text));
    }
  });
});
