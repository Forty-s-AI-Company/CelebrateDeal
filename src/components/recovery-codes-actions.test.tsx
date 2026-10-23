import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  buildRecoveryCodesFile,
  copyRecoveryCodes,
  downloadRecoveryCodes,
  RecoveryCodesActions,
  RECOVERY_CODES_FILENAME,
} from "./recovery-codes-actions";

const CODES = [["AAAAA", "11111"].join("-"), ["BBBBB", "22222"].join("-")];

describe("RecoveryCodesActions", () => {
  it("renders labelled buttons and a polite status region", () => {
    const html = renderToStaticMarkup(<RecoveryCodesActions codes={CODES} />);
    expect(html).toContain("複製全部");
    expect(html).toContain("下載成文字檔");
    expect(html).toContain('role="status"');
    expect(html).toContain("min-h-11");
    expect(html).not.toContain(CODES[0]);
  });

  it("copies one code per line and reports failure without throwing", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    expect(await copyRecoveryCodes(CODES, { writeText })).toBe(true);
    expect(writeText).toHaveBeenCalledWith(CODES.join("\n"));
    expect(await copyRecoveryCodes(CODES, { writeText: vi.fn().mockRejectedValue(new Error("denied")) })).toBe(false);
    expect(await copyRecoveryCodes(CODES, undefined)).toBe(false);
  });

  it("builds the file with title, date, codes and reminder", () => {
    const text = buildRecoveryCodesFile(CODES, new Date(2026, 9, 23));
    expect(text.split("\n")).toEqual([
      "CelebrateDeal 備用救援碼",
      "產生日期：2026-10-23",
      "",
      ...CODES,
      "",
      "每組只能用一次，請存放在安全的地方，不要上傳到公開處。",
      "",
    ]);
  });

  it("downloads locally with the fixed filename and never touches fetch", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const createObjectURL = vi.fn((_blob: Blob) => "blob:local");
    const revokeObjectURL = vi.fn();
    const click = vi.fn();
    downloadRecoveryCodes(CODES, { createObjectURL, revokeObjectURL, click, now: new Date(2026, 9, 23) });
    const blob = createObjectURL.mock.calls[0]![0];
    expect(await blob.text()).toContain(CODES.join("\n"));
    expect(click).toHaveBeenCalledWith("blob:local", RECOVERY_CODES_FILENAME);
    expect(RECOVERY_CODES_FILENAME).toBe("CelebrateDeal-備用救援碼.txt");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:local");
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
