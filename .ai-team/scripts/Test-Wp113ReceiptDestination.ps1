[CmdletBinding()]
param(
  [Parameter(Mandatory)] [string] $WorkspaceRoot,
  [Parameter(Mandatory)] [string] $ReceiptRelativePath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Test-Wp113ReparsePoint([string] $Path) {
  $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
  return [bool]($item.Attributes -band [IO.FileAttributes]::ReparsePoint)
}

function Resolve-Wp113ReceiptDestination([string] $Root, [string] $RelativePath) {
  if ([string]::IsNullOrWhiteSpace($Root) -or [string]::IsNullOrWhiteSpace($RelativePath)) {
    throw 'A non-empty receipt destination is required.'
  }

  $workspace = [IO.Path]::GetFullPath($Root).TrimEnd('\\')
  if (-not (Test-Path -LiteralPath $workspace -PathType Container)) { throw 'Workspace root is unavailable.' }
  if ([IO.Path]::IsPathRooted($RelativePath) -or $RelativePath -match '^[A-Za-z]:' -or $RelativePath -match '^(\\\\|//)') {
    throw 'Receipt destination must be workspace-relative.'
  }

  $normalized = $RelativePath.Replace('/', '\')
  if ($normalized -match '(^|\\)\.\.?(\\|$)' -or $normalized -cnotmatch '^\.ai-team\\reports\\wp113-disposable-schema-prerequisite-\d{17}-[a-f0-9]{8}\.json$') {
    throw 'Receipt destination is outside the WP-113 unique receipt allowlist.'
  }

  $reports = Join-Path $workspace '.ai-team\reports'
  foreach ($node in @($workspace, (Join-Path $workspace '.ai-team'), $reports)) {
    if (-not (Test-Path -LiteralPath $node -PathType Container)) { throw 'Receipt ancestor is unavailable.' }
    if (Test-Wp113ReparsePoint $node) { throw 'Receipt ancestor may not be a symlink, junction, or reparse point.' }
  }

  $destination = [IO.Path]::GetFullPath((Join-Path $workspace $normalized))
  $reportsPrefix = $reports + [IO.Path]::DirectorySeparatorChar
  if ((Split-Path -Parent $destination) -ne $reports -or -not $destination.StartsWith($reportsPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Receipt destination escaped its direct reports directory.'
  }
  if (Test-Path -LiteralPath $destination) { throw 'Receipt destination already exists.' }
  return $destination
}

if ($MyInvocation.InvocationName -ne '.') {
  Resolve-Wp113ReceiptDestination $WorkspaceRoot $ReceiptRelativePath
}
