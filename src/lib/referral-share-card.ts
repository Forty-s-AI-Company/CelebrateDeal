/** Escape every displayed value before inserting it into a downloadable SVG. */
function escapeXml(value: string) {
  return value.replace(/[&<>"']/gu, character => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"})[character]!);
}

export async function generateReferralShareCard(title: string, referralUrl: string) {
  const url = new URL(referralUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || referralUrl.length > 2048) {
    throw new Error('Invalid referral URL');
  }
  // Load QR generation only after an explicit download; never during SSR.
  const {default: QRCode} = await import('qrcode');
  const qr = await QRCode.toDataURL(url.href, {errorCorrectionLevel:'M', margin:2, width:480});
  const characters = Array.from(title).slice(0, 40);
  // Explicit text lengths keep mixed scripts and fallback fonts inside the card.
  const titleLines = [characters.slice(0, 20), characters.slice(20)].filter(line => line.length);
  const safeTitle = titleLines.map((line, index) => `<tspan x="80" y="${300 + index * 60}" textLength="${line.length * 30}" lengthAdjust="spacingAndGlyphs">${escapeXml(line.join(''))}</tspan>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350"><rect width="1080" height="1350" fill="#15223b"/><text x="80" y="160" fill="white" font-size="56">CelebrateDeal</text><text fill="white" font-size="36">${safeTitle}</text><rect x="250" y="460" width="580" height="580" rx="24" fill="white"/><image href="${qr}" x="300" y="510" width="480" height="480"/><text x="540" y="1160" fill="white" text-anchor="middle" font-size="36">掃描 QR Code 查看活動</text></svg>`;
}
