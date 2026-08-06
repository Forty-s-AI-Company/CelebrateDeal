[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$helper = Join-Path $PSScriptRoot 'Test-Wp113ReceiptDestination.ps1'
$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ('celebratedeal-wp113-destination-test-' + [guid]::NewGuid().ToString('N'))

function Assert-Throws([scriptblock] $Action, [string] $Name) {
  try { & $Action } catch { return }
  throw "Expected rejection: $Name"
}

try {
  $workspace = Join-Path $tempRoot 'workspace'
  [IO.Directory]::CreateDirectory((Join-Path $workspace '.ai-team\reports')) | Out-Null
  . $helper -WorkspaceRoot $workspace -ReceiptRelativePath '.ai-team/reports/wp113-disposable-schema-prerequisite-20260731000000000-deadbeef.json'

  $valid = Resolve-Wp113ReceiptDestination $workspace '.ai-team/reports/wp113-disposable-schema-prerequisite-20260731000000000-deadbeef.json'
  if ((Split-Path -Leaf $valid) -ne 'wp113-disposable-schema-prerequisite-20260731000000000-deadbeef.json') { throw 'Valid destination was not returned.' }
  foreach ($invalid in @('', '..\x.json', '.ai-team\reports\wp107-payuni-webhook-disposable-schema-receipt.json', '.ai-team\reports\wp113-disposable-schema-prerequisite-20260731000000000-DEADBEEF.json', 'C:\temp\x.json', '\\server\share\x.json')) {
    Assert-Throws { Resolve-Wp113ReceiptDestination $workspace $invalid } $invalid
  }
  [IO.File]::WriteAllText($valid, '{}')
  Assert-Throws { Resolve-Wp113ReceiptDestination $workspace '.ai-team/reports/wp113-disposable-schema-prerequisite-20260731000000000-deadbeef.json' } 'existing destination'

  $reparseRoot = Join-Path $tempRoot 'reparse-workspace'
  $targetReports = Join-Path $tempRoot 'target-reports'
  [IO.Directory]::CreateDirectory((Join-Path $reparseRoot '.ai-team')) | Out-Null
  [IO.Directory]::CreateDirectory($targetReports) | Out-Null
  New-Item -ItemType Junction -Path (Join-Path $reparseRoot '.ai-team\reports') -Target $targetReports | Out-Null
  Assert-Throws { Resolve-Wp113ReceiptDestination $reparseRoot '.ai-team/reports/wp113-disposable-schema-prerequisite-20260731000000000-cafebabe.json' } 'reparse ancestor'
  Write-Output 'WP-113 receipt destination validation PASS'
} finally {
  if (Test-Path -LiteralPath $tempRoot) { Remove-Item -LiteralPath $tempRoot -Recurse -Force }
}
