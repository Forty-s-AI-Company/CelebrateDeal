# 建立 Cloudflare Stream signing key，並依序把 key id 與 PEM 放進剪貼簿，讓你貼進 Vercel。
# 金鑰不會顯示在畫面上，也不會寫進任何檔案。說明見 docs/operations/stream-signed-urls-plan.md 第 8 節。
# 用法（PowerShell 7）：pwsh -File ops/cloudflare/create-stream-signing-key.ps1
$ErrorActionPreference = 'Stop'
$account = '4050e29f76aba5857685eea94873979b'

$secure = Read-Host '貼上 Cloudflare API Token（需要 Stream:Edit 權限；畫面不會顯示）' -AsSecureString
$token = [System.Net.NetworkCredential]::new('', $secure).Password
try {
  $response = Invoke-RestMethod -Method Post -Uri "https://api.cloudflare.com/client/v4/accounts/$account/stream/keys" -Headers @{ Authorization = "Bearer $token" }
} catch {
  Write-Host "建立失敗：HTTP $($_.Exception.Response.StatusCode.value__)。請確認 token 有 Account > Stream > Edit 權限。" -ForegroundColor Red
  exit 1
} finally {
  $token = $null
}
if (-not $response.success) { Write-Host '建立失敗：Cloudflare 回應 success=false。' -ForegroundColor Red; exit 1 }

Set-Clipboard -Value $response.result.id
Write-Host ''
Write-Host '【1/2】已把 key id 複製到剪貼簿。'
Write-Host '      到 Vercel celebrate-deal-staging → Settings → Environment Variables → Add New：'
Write-Host '      Key = CLOUDFLARE_STREAM_SIGNING_KEY_ID，Environment 只勾 Preview，Value 貼上，按 Save（不要按 Redeploy）。'
Read-Host '      完成後按 Enter' | Out-Null

Set-Clipboard -Value $response.result.pem
Write-Host ''
Write-Host '【2/2】已把 PEM 私鑰複製到剪貼簿。'
Write-Host '      同樣新增：Key = CLOUDFLARE_STREAM_SIGNING_KEY_PEM，只勾 Preview，勾 Sensitive，Value 貼上，按 Save。'
Read-Host '      完成後按 Enter（會清空剪貼簿）' | Out-Null

Set-Clipboard -Value ' '
$response = $null
Write-Host ''
Write-Host '完成，剪貼簿已清空。回到對話告訴 Claude「簽章金鑰設好了」。' -ForegroundColor Green
