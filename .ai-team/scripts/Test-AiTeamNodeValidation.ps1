[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$fixture = Join-Path $repoRoot ('.ai-team\tmp\snapshot-regression-' + [guid]::NewGuid().ToString('N'))
$pwsh = (Get-Command pwsh -ErrorAction Stop).Source
$git = (Get-Command git -ErrorAction Stop).Source
try {
    $priorPath = $env:PATH
    try {
        # SnapshotOnly must work even when npm cannot be resolved from PATH.
        $env:PATH = ''
        if ($null -ne (Get-Command npm -ErrorAction SilentlyContinue)) { throw 'npm unexpectedly remained resolvable in isolated test PATH' }
        $output = & $pwsh -NoProfile -File (Join-Path $PSScriptRoot 'Invoke-AiTeamNodeValidation.ps1') `
            -Destination $fixture -SnapshotOnly -GitExecutable $git | Out-String
    } finally {
        $env:PATH = $priorPath
    }
    if ($LASTEXITCODE -ne 0) { throw 'snapshot-only validation failed' }
    $receipt = $output | ConvertFrom-Json
    if ($receipt.status -ne 'SNAPSHOT_READY' -or -not $receipt.required_config_present) { throw 'snapshot receipt is incomplete' }
    if (-not (Test-Path -LiteralPath (Join-Path $fixture 'config\build-env.controlled.json') -PathType Leaf)) {
        throw 'tracked controlled build config was omitted'
    }
    $expected = @(& git -C $repoRoot ls-files --cached | Where-Object {
        $path = $_.Replace('\','/')
        $segments = $path.Split('/')
        -not ($segments | Where-Object { $_ -eq '.env' -or $_.StartsWith('.env.', [StringComparison]::OrdinalIgnoreCase) }) -and
        $path -notmatch '^(?:node_modules|\.ai-team/(?:\.venv|tmp|runtime|logs|state|worktrees))(?:/|$)'
    }).Count
    if ($receipt.copied_count -ne $expected) { throw 'snapshot did not copy the complete safe tracked-file set' }
    Write-Output 'AI_TEAM_NODE_SNAPSHOT_TEST=PASS'
} finally {
    $resolved = [IO.Path]::GetFullPath($fixture)
    $allowed = [IO.Path]::GetFullPath((Join-Path $repoRoot '.ai-team\tmp')).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    if (-not $resolved.StartsWith($allowed, [StringComparison]::OrdinalIgnoreCase) -or (Split-Path $resolved -Leaf) -notlike 'snapshot-regression-*') {
        throw 'Invalid snapshot fixture cleanup target'
    }
    if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
