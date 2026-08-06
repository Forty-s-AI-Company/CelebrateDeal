[CmdletBinding()]
param([string]$RunId = ('wp-51-wp25-evidence-conflict-' + (Get-Date -Format 'yyyyMMddHHmmssfff')))

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# Static conflict evidence only: no WP-25 execution, imports, child processes, or services.
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$base = Join-Path $repoRoot '.ai-team\reports\wp-25-webinar-owner-boundary-20260729101330072'
$reportRoot = Join-Path $repoRoot ('.ai-team\reports\' + $RunId)
$reportPath = Join-Path $reportRoot 'conflict-evidence.sanitized.json'
$expected = [ordered]@{
  'final-runner-summary.sanitized.json' = '2BBCF0854912F9E186D37CB9A563CE711DE6F3649485447BF4C7FA8896E8802D'
  'browser-verdict.sanitized.json' = 'C539993ADE820BDDEB9DE558946CB30C781E2C5B65FB4C7771AF50CE57D5E597'
  'db-invariant-summary.sanitized.json' = '2C6A13886DA4A52AF307D4FA5D37F77E946339E127451D8DB84DD35ACCAB6F0D'
  'command-receipts.sanitized.json' = '2BBCF0854912F9E186D37CB9A563CE711DE6F3649485447BF4C7FA8896E8802D'
}

if (Test-Path -LiteralPath $reportRoot) { throw 'WP-51 report directory already exists.' }
New-Item -ItemType Directory -Path $reportRoot -Force | Out-Null
try {
  $records=@()
  foreach($name in $expected.Keys){
    $path=Join-Path $base $name
    $resolved=(Resolve-Path -LiteralPath $path -ErrorAction Stop).Path
    if(-not $resolved.StartsWith($base,[System.StringComparison]::OrdinalIgnoreCase)){throw "Path escapes fixed WP-25 report directory: $name"}
    if($name -notmatch '\.sanitized\.json$'){throw "Non-sanitized input rejected: $name"}
    $bytes=[System.IO.File]::ReadAllBytes($resolved)
    try { [void]([System.IO.File]::ReadAllText($resolved)|ConvertFrom-Json) } catch { throw "Invalid JSON: $name" }
    $hash=(Get-FileHash -LiteralPath $resolved -Algorithm SHA256).Hash
    if($hash -ne $expected[$name]){throw "Hash drift: $name"}
    $records += [ordered]@{path=('.ai-team/reports/wp-25-webinar-owner-boundary-20260729101330072/'+$name);bytes=$bytes.Length;sha256=$hash}
  }
  $final=Join-Path $base 'final-runner-summary.sanitized.json'
  $receipts=Join-Path $base 'command-receipts.sanitized.json'
  $samePath=((Resolve-Path $final).Path -eq (Resolve-Path $receipts).Path)
  $sameBytes=[System.Linq.Enumerable]::SequenceEqual([byte[]][System.IO.File]::ReadAllBytes($final),[byte[]][System.IO.File]::ReadAllBytes($receipts))
  if($samePath -or -not $sameBytes){throw 'Expected content-alias conflict was not reproduced.'}
  if(Test-Path -LiteralPath (Join-Path $base 'checkpoint.sanitized.json')){throw 'Unexpected WP-25 checkpoint exists.'}
  $packet=[ordered]@{
    workPackage='WP-51 WP-25 Evidence Conflict Reconciliation';runId=$RunId
    executionLedger=[ordered]@{TARGET_WP_EXECUTED='NO';CHILD_PROCESS_STARTED='NO';ENV_FILE_ACCESSED='NO';DATABASE_CONNECTED='NO';BACKUP_EXECUTED='NO';NETWORK_REQUESTED='NO'}
    inputs=@($records)
    classification=[ordered]@{WP25_RUNTIME_ARTIFACTS_PRESENT='YES';WP25_CHECKPOINT_PRESENT='NO';CONTENT_ALIAS_CONFLICT='CONFIRMED';COMMAND_RECEIPTS_INDEPENDENTLY_VERIFIABLE='NO';WP25_ACCEPTANCE_STATUS='UNPROVEN';WP25_EVIDENCE_CLASSIFICATION='CONFLICT_OR_STALE';ACCEPTED_METADATA_CREATED='NO';G1_STATUS='BLOCKED';READINESS_SCORE_CHANGE=0}
    conflict=[ordered]@{distinctPaths=$true;finalAndReceiptsByteEquality=$true;finalAndReceiptsBytes=13466;sha256=$expected['final-runner-summary.sanitized.json']}
    limitations=@('No acceptance inference made.','No checkpoint created or modified.','Original WP-25 artifacts were not executed or changed.')
  }
  $packet|ConvertTo-Json -Depth 8|Set-Content -LiteralPath $reportPath -Encoding UTF8
  Write-Output $reportPath
} catch { if(Test-Path -LiteralPath $reportRoot){Remove-Item -LiteralPath $reportRoot -Recurse -Force}; throw }
