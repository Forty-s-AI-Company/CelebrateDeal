[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$configPath = Join-Path $repoRoot '.codex\config.toml'
$projectPython = Join-Path $repoRoot '.ai-team\.venv\Scripts\python.exe'
$runtimePython = if (Test-Path -LiteralPath $projectPython -PathType Leaf) { $projectPython } else { (Get-Command python -ErrorAction Stop).Source }
$fixture = Join-Path ([IO.Path]::GetTempPath()) ('ai-team-bootstrap-' + [guid]::NewGuid().ToString('N'))

function Assert-Bootstrap([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw "ASSERTION_FAILED: $Message" }
}

try {
    $configSource = [IO.File]::ReadAllText($configPath)
    Assert-Bootstrap ($configSource -notmatch '(?i)C:\\Users\\|\\eden\\|Downloads\\AI\\CelebrateDeal') 'MCP config contains a user-specific absolute path'
    Assert-Bootstrap ($configSource -match 'Start-AiTeamMcp\.ps1') 'MCP config does not use the repository launcher'
    Assert-Bootstrap (Test-Path -LiteralPath $runtimePython -PathType Leaf) 'Python runtime is unavailable for relocation probe'

    foreach ($relative in @(
        '.ai-team/config', '.ai-team/mcp_server', '.ai-team/scripts', '.ai-team/prompts', '.codex'
    )) {
        New-Item -ItemType Directory -Path (Join-Path $fixture $relative) -Force | Out-Null
    }
    foreach ($relative in @(
        '.ai-team/config/router.json', '.ai-team/config/routing-policy.json',
        '.ai-team/mcp_server/server.py', '.ai-team/mcp_server/routing.py',
        '.ai-team/mcp_server/bootstrap_probe.py', '.ai-team/mcp_server/requirements.txt',
        '.ai-team/scripts/Start-AiTeamMcp.ps1', '.ai-team/prompts/reviewer-prompt.md',
        '.codex/config.toml'
    )) {
        Copy-Item -LiteralPath (Join-Path $repoRoot $relative) -Destination (Join-Path $fixture $relative) -Force
    }

    Push-Location ([IO.Path]::GetTempPath())
    try {
        $output = & pwsh -NoProfile -File (Join-Path $fixture '.ai-team/scripts/Start-AiTeamMcp.ps1') `
            -BootstrapOnly -PythonExecutable $runtimePython | Out-String
    } finally {
        Pop-Location
    }
    Assert-Bootstrap ($LASTEXITCODE -eq 0) 'relocated launcher probe failed'
    $probe = $output | ConvertFrom-Json
    Assert-Bootstrap ($probe.status -eq 'ok' -and $probe.router_status -eq 'ok') 'router_status failed after relocation'
    Assert-Bootstrap ($probe.route_model -eq 'gpt-6-luna') 'route_task failed after relocation'
    Write-Output 'AI_TEAM_BOOTSTRAP_TEST=PASS'
} finally {
    $resolved = [IO.Path]::GetFullPath($fixture)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    if (-not $resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -or (Split-Path $resolved -Leaf) -notlike 'ai-team-bootstrap-*') {
        throw 'Invalid bootstrap fixture cleanup target'
    }
    if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
