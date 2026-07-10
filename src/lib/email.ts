type SendEmailInput = {
  to: string;
  subject: string;
  html?: string;
  text?: string;
};

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export async function sendTransactionalEmail(input: SendEmailInput) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (!apiKey || !from) {
    throw new Error("Resend env is not configured.");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    }),
  });

  if (!response.ok) {
    throw new Error(`Resend email failed: ${await response.text()}`);
  }

  return response.json();
}

export async function sendPasswordResetEmail({
  to,
  resetUrl,
}: {
  to: string;
  resetUrl: string;
}) {
  const safeTo = escapeHtml(to);
  const safeResetUrl = escapeHtml(resetUrl);
  return sendTransactionalEmail({
    to,
    subject: "CelebrateDeal 密碼重設連結",
    text: `你收到這封信，是因為有人為 ${to} 申請密碼重設。\n\n請在 30 分鐘內開啟以下連結完成設定：\n${resetUrl}\n\n如果不是你本人操作，可以直接忽略這封信。`,
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.7;color:#0f172a">
        <h2 style="margin:0 0 12px">CelebrateDeal 密碼重設</h2>
        <p>你收到這封信，是因為有人為 <strong>${safeTo}</strong> 申請密碼重設。</p>
        <p>請在 30 分鐘內使用以下連結完成設定：</p>
        <p><a href="${safeResetUrl}" style="display:inline-block;padding:12px 18px;background:#2563eb;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">重設密碼</a></p>
        <p style="word-break:break-all;color:#475569">${safeResetUrl}</p>
        <p>如果不是你本人操作，可以直接忽略這封信。</p>
      </div>
    `,
  });
}
