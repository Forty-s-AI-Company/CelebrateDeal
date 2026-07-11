[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$python = (Get-Command python -CommandType Application -ErrorAction Stop).Source
& $python (Join-Path $PSScriptRoot "windows_credentials.py") delete
if ($LASTEXITCODE -ne 0) {
    throw "Credential Manager 刪除失敗"
}
