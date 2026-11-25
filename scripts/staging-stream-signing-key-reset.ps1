# F-093：重建 staging 的 Cloudflare Stream 簽章金鑰，並把同一次回應的 id 與 pem
# 一起寫入 Vercel 專案 celebrate-deal-staging 的 Preview 環境變數。
#
# 只能由 owner 在自己的電腦執行：Cloudflare API token 用隱藏輸入，金鑰內容不會印在畫面上，
# 也不會寫入檔案。需要：Cloudflare API token（權限 Stream:Edit）與 Cloudflare Account ID；
# Vercel 用本機 `vercel login` 的登入，找不到時會請你貼一個 Vercel token（隱藏輸入）。
#
# 背景（2026-11-26）：staging 鎖定影片後，Cloudflare 對我們簽的 token 回
# 「failed to verify signature」，表示 Vercel 上的 KEY_ID 與 PEM 不是同一把金鑰
# （建立時多建過一把）。這支腳本建立新的一把、兩個值一起更新。

$ErrorActionPreference = "Stop"
$team = "a25814740s-projects"
$project = "celebrate-deal-staging"

function ConvertFrom-Secure([Security.SecureString] $value) {
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($value)
  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

$account = (Read-Host "Cloudflare Account ID（Cloudflare 後台右側 Account ID）").Trim()
if ($account -notmatch '^[0-9a-f]{32}$') { throw "Account ID 格式不對（應為 32 個 0-9a-f 字元）" }
$cfToken = ConvertFrom-Secure (Read-Host "Cloudflare API token（Stream:Edit，輸入時不會顯示）" -AsSecureString)

$vercelToken = $null
foreach ($path in @("$env:APPDATA\com.vercel.cli\Data\auth.json", "$env:APPDATA\com.vercel.cli\auth.json", "$env:USERPROFILE\.local\share\com.vercel.cli\auth.json")) {
  if (Test-Path $path) { $vercelToken = (Get-Content $path -Raw | ConvertFrom-Json).token; if ($vercelToken) { break } }
}
if (-not $vercelToken) { $vercelToken = ConvertFrom-Secure (Read-Host "找不到 vercel 登入，請貼 Vercel token（輸入時不會顯示）" -AsSecureString) }

Write-Host "1/3 建立新的 Stream 簽章金鑰…"
$created = Invoke-RestMethod -Method Post -Uri "https://api.cloudflare.com/client/v4/accounts/$account/stream/keys" -Headers @{ Authorization = "Bearer $cfToken" }
if (-not $created.success -or -not $created.result.id -or -not $created.result.pem) { throw "Cloudflare 沒有回傳金鑰（請確認 token 有 Stream:Edit 權限）" }
$keyId = $created.result.id
$pem = $created.result.pem

Write-Host "2/3 確認金鑰已登記在這個帳號…"
$keys = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/accounts/$account/stream/keys" -Headers @{ Authorization = "Bearer $cfToken" }
if (-not ($keys.result | Where-Object { $_.id -eq $keyId })) { throw "新金鑰不在清單中，停止（Vercel 沒有被改動）" }
$keyCount = @($keys.result).Count

Write-Host "3/3 更新 Vercel（$project，Preview）…"
$uri = "https://api.vercel.com/v10/projects/$project/env?upsert=true&slug=$team"
$body = ConvertTo-Json @(
  @{ key = "CLOUDFLARE_STREAM_SIGNING_KEY_ID"; value = $keyId; type = "encrypted"; target = @("preview") },
  @{ key = "CLOUDFLARE_STREAM_SIGNING_KEY_PEM"; value = $pem; type = "encrypted"; target = @("preview") }
)
$result = Invoke-RestMethod -Method Post -Uri $uri -Headers @{ Authorization = "Bearer $vercelToken" } -ContentType "application/json" -Body $body
if (@($result.failed).Count -gt 0) { throw "Vercel 有欄位沒寫入：$(@($result.failed | ForEach-Object { $_.error.code }) -join ', ')" }

$pem = $null; $cfToken = $null; $vercelToken = $null
Write-Host ""
Write-Host "完成：新金鑰已建立並寫入 Vercel（帳號內目前共有 $keyCount 把金鑰，舊的之後再清）。回到對話回覆「設了」即可。"
