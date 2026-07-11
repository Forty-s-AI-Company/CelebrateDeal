[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$python = (Get-Command python -CommandType Application -ErrorAction Stop).Source
& $python (Join-Path $PSScriptRoot "windows_credentials.py") generate
if ($LASTEXITCODE -ne 0) {
    throw "Credential Manager 金鑰產生失敗"
}
