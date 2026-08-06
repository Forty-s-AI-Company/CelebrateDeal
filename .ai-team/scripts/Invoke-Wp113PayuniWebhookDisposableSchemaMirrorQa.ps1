[CmdletBinding()]
param(
  [Parameter(Mandatory)] [string] $ReceiptRelativePath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
. (Join-Path $PSScriptRoot 'Test-Wp113ReceiptDestination.ps1') -WorkspaceRoot $root -ReceiptRelativePath $ReceiptRelativePath
$destination = Resolve-Wp113ReceiptDestination $root $ReceiptRelativePath
$sourceRunner = Join-Path $root '.ai-team\scripts\Invoke-Wp107PayuniWebhookDisposableSchemaQa.ps1'
$sourceReceipt = Join-Path $root '.ai-team\reports\wp107-payuni-webhook-disposable-schema-receipt.json'
$runId = (Get-Date).ToUniversalTime().ToString('yyyyMMddHHmmssfff')
$nonce = -join (1..8 | ForEach-Object { ('{0:x}' -f (Get-Random -Maximum 16)) })
$tempRoot = Join-Path ([IO.Path]::GetTempPath()) "celebratedeal-wp113-mirror-$runId-$nonce"
$marker = "wp113:${runId}:$nonce"
$mirror = Join-Path $tempRoot 'workspace'
$mirrorReceipt = Join-Path $mirror '.ai-team\reports\wp107-payuni-webhook-disposable-schema-receipt.json'
$historicalSuite = [ordered]@{ files = 6; passed = 109; failed = 0; skipped = 0 }
$currentMirrorSuite = [ordered]@{ files = 6; passed = 117; failed = 0; skipped = 0 }

function Get-Digest([string] $Path) { (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant() }
function Get-Manifest([string] $Path) { @(& git -C $Path status --porcelain=v1 --untracked-files=all | ForEach-Object { $_.Replace('\\','/') } | Sort-Object) }
function Same-Json($Left, $Right) { (($Left | ConvertTo-Json -Depth 32 -Compress) -eq ($Right | ConvertTo-Json -Depth 32 -Compress)) }
function Assert-TempRoot {
  $base = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([IO.Path]::DirectorySeparatorChar)
  $prefix = $base + [IO.Path]::DirectorySeparatorChar
  if (-not $tempRoot.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) -or (Split-Path -Leaf $tempRoot) -notmatch '^celebratedeal-wp113-mirror-\d{17}-[a-f0-9]{8}$') {
    throw 'Temporary mirror boundary rejected.'
  }
}
function Remove-OwnedTemp {
  if (-not (Test-Path -LiteralPath $tempRoot)) { return 'NOT_CREATED' }
  Assert-TempRoot
  $markerPath = Join-Path $tempRoot '.wp113-marker'
  if (-not (Test-Path -LiteralPath $markerPath -PathType Leaf) -or [IO.File]::ReadAllText($markerPath) -ne $marker) { throw 'Temporary mirror marker mismatch.' }
  Remove-Item -LiteralPath $tempRoot -Recurse -Force
  return 'PASS'
}
function New-Receipt([object] $Value) {
  $json = $Value | ConvertTo-Json -Depth 12
  $stream = [IO.File]::Open($destination, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
  try {
    $bytes = [Text.UTF8Encoding]::new($false).GetBytes($json)
    $stream.Write($bytes, 0, $bytes.Length)
  } finally { $stream.Dispose() }
}
function Assert-CurrentSuiteContract {
  $historical = Get-Content -Raw -LiteralPath $sourceReceipt | ConvertFrom-Json
  if ($historical.status -ne 'PASS' -or $historical.migrationCount -ne 13 -or $historical.suite.files -ne 6 -or $historical.suite.passed -ne 109 -or $historical.suite.failed -ne 0 -or $historical.suite.skipped -ne 0 -or $historical.schemaCleanup -ne 'PASS' -or $historical.tempCleanup -ne 'PASS') { throw 'Historical WP-107 baseline is not intact.' }
  $runnerText = Get-Content -Raw -LiteralPath $sourceRunner
  $expectedSuite = @('src/app/api/webhooks/payments/route.test.ts','src/lib/payment-webhooks.test.ts','src/lib/payment-webhook-invariants.test.ts','src/lib/payment-providers/payuni.test.ts','scripts/payuni-sandbox-external-qa.test.mjs','scripts/payuni-sandbox-payment-handoff.test.mjs')
  foreach ($file in $expectedSuite) { if (([regex]::Matches($runnerText, [regex]::Escape("'$file'"))).Count -ne 1) { throw 'WP-107 suite allowlist drifted.' } }
  if (([regex]::Matches($runnerText, 'suiteResult\.passed -ne 109')).Count -ne 1) { throw 'WP-107 historical predicate drifted.' }
  $routeTest = Get-Content -Raw -LiteralPath (Join-Path $root 'src/app/api/webhooks/payments/route.test.ts')
  $sourceCases = [regex]::Matches($routeTest, '\["(return|notify|missing|case variant|duplicate)", "(return|notify|unknown)"\]').Count
  $loggingCases = @('emits one safe POST receipt for explicit success and failure statuses','does not serialize raw query, body, header, identifier, or secret markers','does not emit request receipts outside Preview') | Where-Object { $routeTest.Contains($_) }
  if ($sourceCases -ne 5 -or $loggingCases.Count -ne 3) { throw 'WP-112 eight-test provenance is not exact.' }
  $replacementTitles = @(
    'Sandbox execution preflight is process-env-only and missing values fail before any network stage',
    'Sandbox payment-only preflight does not require a separate finance login',
    'Sandbox host allowlist rejects production, lookalikes, credentials, and explicit ports',
    'Sandbox QA refuses a Deployment Protection callback host before charging a test card',
    'Sandbox QA accepts a public callback 405 but rejects local, redirects, and server failures'
  )
  $sandboxRunnerTest = Get-Content -Raw -LiteralPath (Join-Path $root 'scripts/payuni-sandbox-external-qa.test.mjs')
  if (@($replacementTitles | Where-Object { -not $sandboxRunnerTest.Contains($_) }).Count -ne 0) { throw 'Approved bypass-test replacement coverage is incomplete.' }
  $sandboxRunner = Get-Content -Raw -LiteralPath (Join-Path $root 'scripts/payuni-sandbox-external-qa.mjs')
  if (-not $sandboxRunner.Contains('不得把 Vercel bypass secret 放進 ReturnURL 或 NotifyURL') -or $sandboxRunner -match 'VERCEL_AUTOMATION_BYPASS_SECRET|x-vercel-protection-bypass|x-vercel-set-bypass-cookie') { throw 'Callback bypass policy is absent or weakened.' }
  $historicalSandboxTest = @(& git -C $root show 'HEAD:scripts/payuni-sandbox-external-qa.test.mjs') -join "`n"
  $approvedBlock = [regex]::Match($historicalSandboxTest, '(?ms)^test\("Vercel preview protection bypass cookie URL is explicit and opt-in", \(\) => \{.*?^\}\);')
  if (-not $approvedBlock.Success) { throw 'Approved historical bypass-test block is unavailable.' }
  $allowedRemoved = @($approvedBlock.Value -split "`r?`n" | Where-Object { $_ -match '^\s*(test|it)\(' -or $_ -match '^\s*(assert|expect)\.' } | ForEach-Object { "-$_" })
  $diff = @(& git -C $root diff -U0 -- $expectedSuite)
  $removedAssertions = @($diff | Where-Object { $_ -match '^-(?!-)\s*(it|test)\(' -or $_ -match '^-(?!-)\s*(assert|expect)\.' })
  if ((@($removedAssertions | Sort-Object) -join "`n") -ne (@($allowedRemoved | Sort-Object) -join "`n")) { throw 'Suite diff removes a test or assertion outside the approved bypass-test block.' }
  if (@($diff | Where-Object { $_ -match '^\+(?!\+).*\.(skip|retry|only|todo)\b' }).Count -ne 0) { throw 'Suite diff introduces skip, retry, only, or todo.' }
}

$preManifest = Get-Manifest $root
$runnerDigestBefore = Get-Digest $sourceRunner
$receiptDigestBefore = Get-Digest $sourceReceipt
$result = [ordered]@{
  schemaVersion = 'celebratedeal-ai-team-wp113-mirror/v1'; workPackage = 'WP-113-remediation'; status = 'BLOCKED_OR_FAILED'
  migrationCount = 0; catalog = [ordered]@{ column = $false; index = $false; migrations = $false; pgcrypto = $false }
  suite = [ordered]@{ files = 0; passed = 0; failed = 0; skipped = 0 }; schemaCleanup = 'NOT_STARTED'; tempCleanup = 'NOT_STARTED'
  originalRunnerUnchanged = $false; originalReceiptUnchanged = $false; workspaceManifestUnchanged = $false; stagedIndexEmpty = $false
  mirroredRunnerStatus = 'NOT_STARTED'; mirroredRunnerFailureCategory = 'unknown'
  historicalSuite = $historicalSuite; currentMirrorSuite = $currentMirrorSuite; deltaPassed = 8
  externalSideEffects = $false; sandboxPaymentCreated = $false; environmentFileContentsRead = $false; failureCategory = 'unknown'
}

try {
  if ([string]::IsNullOrWhiteSpace((git -C $root diff --cached --name-only))) { $result.stagedIndexEmpty = $true } else { throw 'Staged index is not empty.' }
  Assert-CurrentSuiteContract
  Assert-TempRoot
  [IO.Directory]::CreateDirectory($tempRoot) | Out-Null
  [IO.File]::WriteAllText((Join-Path $tempRoot '.wp113-marker'), $marker, [Text.UTF8Encoding]::new($false))
  $robocopy = (Get-Command robocopy.exe -ErrorAction Stop).Source
  & $robocopy $root $mirror /E /R:0 /W:0 /XD '.git' 'node_modules' '.ai-team' '.next' '.vercel' 'supabase' /XF '.env' '.env.*' | Out-Null
  if ($LASTEXITCODE -gt 7) { throw 'Temporary mirror copy failed.' }
  $forbidden = @(Get-ChildItem -LiteralPath $mirror -Force -Recurse | Where-Object { $_.Name -like '.env*' -or $_.FullName -match '(?i)\\supabase\\\.temp(\\|$)' })
  if ($forbidden.Count -ne 0) { throw 'Temporary mirror contains excluded runtime metadata.' }
  New-Item -ItemType Junction -Path (Join-Path $mirror 'node_modules') -Target (Join-Path $root 'node_modules') | Out-Null
  $mirrorScripts = Join-Path $mirror '.ai-team\scripts'; $mirrorReports = Join-Path $mirror '.ai-team\reports'
  [IO.Directory]::CreateDirectory($mirrorScripts) | Out-Null; [IO.Directory]::CreateDirectory($mirrorReports) | Out-Null
  $mirrorRunner = Join-Path $mirrorScripts (Split-Path -Leaf $sourceRunner)
  $mirrorRunnerText = Get-Content -Raw -LiteralPath $sourceRunner
  if (([regex]::Matches($mirrorRunnerText, 'suiteResult\.passed -ne 109')).Count -ne 1) { throw 'Mirror predicate transformation is not unique.' }
  $mirrorRunnerText = $mirrorRunnerText.Replace('suiteResult.passed -ne 109', 'suiteResult.passed -ne 117').Replace('109/109.', '117/117.')
  [IO.File]::WriteAllText($mirrorRunner, $mirrorRunnerText, [Text.UTF8Encoding]::new($false))
  [IO.File]::WriteAllText($mirrorReceipt, '{}', [Text.UTF8Encoding]::new($false))
  & git -C $mirror init -q
  & $mirrorRunner
  $mirrorResult = Get-Content -Raw -LiteralPath $mirrorReceipt | ConvertFrom-Json
  $result.mirroredRunnerStatus = if ([string]$mirrorResult.status -in @('PASS', 'BLOCKED_OR_FAILED')) { [string]$mirrorResult.status } else { 'unknown' }
  $result.mirroredRunnerFailureCategory = if ([string]$mirrorResult.failureCategory -in @('none', 'schema-or-migration', 'deterministic-suite', 'local-toolchain', 'preflight-or-runner', 'ownership', 'cleanup', 'unknown')) { [string]$mirrorResult.failureCategory } else { 'unknown' }
  foreach ($field in @('files', 'passed', 'failed', 'skipped')) {
    $value = [int]($mirrorResult.suite.$field)
    if ($value -lt 0 -or $value -gt 10000) { throw 'Mirrored suite count was outside the safe range.' }
    $result.suite[$field] = $value
  }
  if ($LASTEXITCODE -ne 0) { throw 'Mirrored WP-107 runner failed.' }
  if ($mirrorResult.status -ne 'PASS' -or $mirrorResult.migrationCount -ne 13 -or $mirrorResult.suite.files -ne 6 -or $mirrorResult.suite.passed -ne 117 -or $mirrorResult.suite.failed -ne 0 -or $mirrorResult.suite.skipped -ne 0 -or $mirrorResult.schemaCleanup -ne 'PASS' -or $mirrorResult.tempCleanup -ne 'PASS') { throw 'Mirrored deterministic receipt did not meet the current 117-test contract.' }
  if (-not $mirrorResult.catalog.column -or -not $mirrorResult.catalog.index -or -not $mirrorResult.catalog.migrations -or -not $mirrorResult.catalog.pgcrypto) { throw 'Mirrored catalog assertion failed.' }
  $result.status = 'PASS'; $result.failureCategory = 'none'; $result.migrationCount = 13
  $result.catalog = [ordered]@{ column = $true; index = $true; migrations = $true; pgcrypto = $true }
  $result.suite = $currentMirrorSuite; $result.schemaCleanup = 'PASS'
} catch {
  $result.failureCategory = 'mirror-or-deterministic'; $result.failure = $_.Exception.Message
} finally {
  try { $result.tempCleanup = Remove-OwnedTemp } catch { $result.tempCleanup = 'FAIL'; if ($result.status -eq 'PASS') { $result.status = 'BLOCKED_OR_FAILED'; $result.failureCategory = 'cleanup'; $result.failure = 'Temporary mirror cleanup failed.' } }
  $result.originalRunnerUnchanged = ((Get-Digest $sourceRunner) -eq $runnerDigestBefore)
  $result.originalReceiptUnchanged = ((Get-Digest $sourceReceipt) -eq $receiptDigestBefore)
  $result.workspaceManifestUnchanged = (Same-Json $preManifest (Get-Manifest $root))
  if (-not $result.originalRunnerUnchanged -or -not $result.originalReceiptUnchanged -or -not $result.workspaceManifestUnchanged -or -not $result.stagedIndexEmpty) { $result.status = 'BLOCKED_OR_FAILED'; $result.failureCategory = 'ownership' }
  New-Receipt $result
}

if ($result.status -ne 'PASS') { exit 1 }
Write-Output 'WP-113 disposable schema mirror QA PASS'
