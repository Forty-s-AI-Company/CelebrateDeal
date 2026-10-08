"use client";

import {useState} from 'react';
import {generateReferralShareCard} from '@/lib/referral-share-card';

/** Receives an authorized, canonical public link; no participant data is shared. */
export function ReferralShareControls({title, referralUrl}: {title:string; referralUrl:string}) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function perform(download:boolean) {
    setBusy(true);
    setMessage('');
    try {
      if (download) {
        const svg = await generateReferralShareCard(title, referralUrl);
        const objectUrl = URL.createObjectURL(new Blob([svg], {type:'image/svg+xml;charset=utf-8'}));
        const anchor = document.createElement('a');
        anchor.href = objectUrl;
        anchor.download = 'celebratedeal-referral.svg';
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
        // Give the browser time to consume the download before releasing it.
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
        setMessage('分享圖已準備下載');
      } else {
        await navigator.clipboard.writeText(referralUrl);
        setMessage('推廣連結已複製');
      }
    } catch {
      setMessage(download ? '分享圖產生失敗，請重試。' : '無法複製，請選取下方連結手動複製。');
    } finally {
      setBusy(false);
    }
  }
  return <div className="mb-4 grid gap-2">
    <div className="flex flex-wrap gap-2"><button type="button" disabled={busy} className="min-h-11 rounded border px-3" onClick={() => void perform(false)}>複製推廣連結</button><button type="button" disabled={busy} className="min-h-11 rounded border px-3" onClick={() => void perform(true)}>下載 QR 分享圖</button></div>
    <input aria-label={`${title}推廣連結`} readOnly value={referralUrl} className="w-full rounded border p-2" onFocus={event => event.currentTarget.select()}/>
    <p role="status" aria-live="polite">{message}</p>
  </div>;
}
