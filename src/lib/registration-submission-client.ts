/** Shared browser transport: keep attribution payloads intact and never expose server errors. */
export async function postRegistrationSubmission(body: Record<string, unknown>): Promise<Response> {
  const response = await fetch("/api/form-submissions", {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/json", "X-CelebrateDeal-Client": "web" },
    body: JSON.stringify(body),
  });
  if (!response.ok) return response;
  // 只接受 API 明確回覆；代理錯誤頁或重新導向不能冒充報名成功。
  try {
    if (!response.redirected && /^application\/json(?:\s*;|$)/iu.test(response.headers.get("content-type") ?? "")) {
      const result: unknown = await response.clone().json();
      if (result && typeof result === "object" && "ok" in result && result.ok === true && "verificationRequired" in result && result.verificationRequired === true) return response;
    }
  } catch { /* 回應格式不符時保留欄位，不向使用者顯示伺服器內容。 */ }
  return new Response(null, { status: 503 });
}

export function formSubmissionErrorMessage(status?: number) {
  if (status === 400) return "請確認必填欄位與資料格式後再送出。";
  if (status === 403) return "這次送出未通過安全檢查，請重新整理頁面後再試。";
  if (status === 429) return "送出次數太頻繁，請稍候一分鐘再試。";
  if (status === 404 || status === 503) return "這張表單目前無法接收資料，請稍後再試。";
  // 已收到 HTTP 回應時，不把伺服器拒絕或故障誤指為網路問題。
  if (status !== undefined) return "資料暫時無法送出；內容仍保留，請稍後再試。";
  return "送出失敗；內容仍保留，請檢查網路後再試。";
}

export const FORM_SUBMISSION_VERIFICATION_MESSAGE = "請到 Email 開啟確認連結；完成確認後才會列入正式名單。";
