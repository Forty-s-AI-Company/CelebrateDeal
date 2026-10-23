"use client";

import { useEffect, useRef, useState } from "react";

export const RECOVERY_CODES_FILENAME = "CelebrateDeal-備用救援碼.txt";
export const COPIED_MESSAGE = "已複製，請貼到密碼管理員或安全的地方";
export const COPY_FAILED_MESSAGE = "這個瀏覽器無法自動複製，請用滑鼠或手指選取上方的救援碼後自行複製。";

export function buildRecoveryCodesFile(codes: string[], now: Date = new Date()) {
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return [
    "CelebrateDeal 備用救援碼",
    `產生日期：${date}`,
    "",
    ...codes,
    "",
    "每組只能用一次，請存放在安全的地方，不要上傳到公開處。",
    "",
  ].join("\n");
}

export async function copyRecoveryCodes(codes: string[], clipboard: Pick<Clipboard, "writeText"> | undefined) {
  if (!clipboard) return false;
  try {
    await clipboard.writeText(codes.join("\n"));
    return true;
  } catch {
    return false;
  }
}

export function downloadRecoveryCodes(
  codes: string[],
  env: {
    createObjectURL: (blob: Blob) => string;
    revokeObjectURL: (url: string) => void;
    click: (href: string, download: string) => void;
    now?: Date;
  },
) {
  const blob = new Blob([buildRecoveryCodesFile(codes, env.now)], { type: "text/plain;charset=utf-8" });
  const url = env.createObjectURL(blob);
  env.click(url, RECOVERY_CODES_FILENAME);
  env.revokeObjectURL(url);
}

const buttonClass =
  "inline-flex min-h-11 items-center justify-center rounded-xl border border-blue-200 bg-white px-4 text-sm font-semibold text-blue-700 hover:bg-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600";

export function RecoveryCodesActions({ codes }: { codes: string[] }) {
  const [message, setMessage] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  async function onCopy() {
    const ok = await copyRecoveryCodes(codes, typeof navigator === "undefined" ? undefined : navigator.clipboard);
    setMessage(ok ? COPIED_MESSAGE : COPY_FAILED_MESSAGE);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(""), ok ? 3000 : 8000);
  }

  function onDownload() {
    downloadRecoveryCodes(codes, {
      createObjectURL: (blob) => URL.createObjectURL(blob),
      revokeObjectURL: (url) => URL.revokeObjectURL(url),
      click: (href, download) => {
        const link = document.createElement("a");
        link.href = href;
        link.download = download;
        document.body.appendChild(link);
        link.click();
        link.remove();
      },
    });
  }

  return (
    <div className="mt-4 grid gap-2">
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onCopy} className={buttonClass}>複製全部</button>
        <button type="button" onClick={onDownload} className={buttonClass}>下載成文字檔</button>
      </div>
      <p role="status" aria-live="polite" className="min-h-5 text-sm text-slate-700">{message}</p>
    </div>
  );
}
