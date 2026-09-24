[CmdletBinding()]
param(
    [switch]$BootstrapOnly,
    [string]$PythonExecutable = ''
)

$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$teamRoot = Join-Path $repoRoot '.ai-team'
$requirements = Join-Path $teamRoot 'mcp_server\requirements.txt'
$server = Join-Path $teamRoot 'mcp_server\server.py'
$probe = Join-Path $teamRoot 'mcp_server\bootstrap_probe.py'
$config = Join-Path $teamRoot 'config\router.json'

foreach ($required in @($requirements, $server, $probe, $config)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
        throw "AI Team MCP bootstrap is missing a repository file: $([IO.Path]::GetFileName($required))"
    }
}

if ([string]::IsNullOrWhiteSpace($PythonExecutable)) {
    $runtimePython = if ($IsWindows) {
        Join-Path $teamRoot '.venv\Scripts\python.exe'
    } else {
        Join-Path $teamRoot '.venv/bin/python'
    }
    if (-not (Test-Path -LiteralPath $runtimePython -PathType Leaf)) {
        $hostPython = Get-Command python -ErrorAction Stop
        & $hostPython.Source -m venv (Join-Path $teamRoot '.venv')
        if ($LASTEXITCODE -ne 0) { throw 'Unable to create the project-local AI Team Python runtime.' }
    }
} else {
    $runtimePython = [IO.Path]::GetFullPath($PythonExecutable)
}

if (-not (Test-Path -LiteralPath $runtimePython -PathType Leaf)) {
    throw 'AI Team MCP Python interpreter is unavailable.'
}

& $runtimePython -c 'import mcp, tomlkit' 2>$null
if ($LASTEXITCODE -ne 0) {
    if (-not [string]::IsNullOrWhiteSpace($PythonExecutable)) {
        throw 'The explicitly supplied Python interpreter does not contain the locked MCP dependencies.'
    }
    & $runtimePython -m pip install --disable-pip-version-check -r $requirements
    if ($LASTEXITCODE -ne 0) { throw 'Unable to install the locked AI Team MCP dependencies.' }
}

$env:AI_TEAM_ROOT = $repoRoot
$env:AI_TEAM_CONFIG = $config
if ($BootstrapOnly) {
    & $runtimePython $probe
    exit $LASTEXITCODE
}

& $runtimePython $server
exit $LASTEXITCODE
