Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-CelebrateDealExecute {
  param([switch]$Execute, [string]$Action)
  if (-not $Execute) {
    throw "$Action is blocked by default. Re-run only after approval with -Execute."
  }
}

function Test-CelebrateDealCommand {
  param([Parameter(Mandatory)][string]$Name)
  $command = Get-Command -Name $Name -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }

  # PostgreSQL's Windows installer does not always amend PATH for the account
  # that will run Task Scheduler. Resolve only its conventional install root;
  # callers still receive a concrete executable path and never a shell command.
  if ($env:OS -eq 'Windows_NT' -and $Name -match '^(pg_dump|pg_restore|psql)(\.exe)?$' -and $env:ProgramFiles) {
    $binary = if ($Name.EndsWith('.exe')) { $Name } else { "$Name.exe" }
    $postgresRoot = Join-Path $env:ProgramFiles 'PostgreSQL'
    if (Test-Path -LiteralPath $postgresRoot -PathType Container) {
      $candidate = Get-ChildItem -LiteralPath $postgresRoot -Directory -ErrorAction SilentlyContinue |
        Sort-Object Name -Descending |
        ForEach-Object { Join-Path $_.FullName "bin\\$binary" } |
        Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
        Select-Object -First 1
      if ($candidate) { return $candidate }
    }
  }

  throw "Required command '$Name' was not found."
}

function Import-CelebrateDealCredentialManagerIfAvailable {
  if (Get-Command Get-StoredCredential -ErrorAction SilentlyContinue) { return $true }

  $module = Get-Module -ListAvailable -Name CredentialManager |
    Sort-Object Version -Descending |
    Select-Object -First 1
  if (-not $module) { return $false }

  try {
    Import-Module -Name $module.Path -ErrorAction Stop -Global
    return [bool](Get-Command Get-StoredCredential -ErrorAction SilentlyContinue)
  }
  catch {
    return $false
  }
}

function Get-CelebrateDealSecretText {
  param(
    [Parameter(Mandatory)][string]$Name,
    [string]$Vault
  )

  if (Get-Command Get-Secret -ErrorAction SilentlyContinue) {
    try {
      $arguments = @{ Name = $Name; AsPlainText = $true; ErrorAction = 'Stop' }
      if ($Vault) { $arguments.Vault = $Vault }
      $value = Get-Secret @arguments
      if (-not [string]::IsNullOrWhiteSpace($value)) { return [string]$value }
    }
    catch {
      # When no registered SecretManagement vault contains this name, use the
      # explicitly supported Credential Manager backend below. Never log data.
    }
  }

  if (Import-CelebrateDealCredentialManagerIfAvailable) {
    $credential = Get-StoredCredential -Target $Name
    if (-not $credential) { throw "Credential Manager entry '$Name' was not found." }
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($credential.Password)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  }

  throw 'Install and configure Microsoft.PowerShell.SecretManagement, or install the CredentialManager module. No secret fallback is allowed.'
}

function Test-CelebrateDealSecretName {
  param(
    [Parameter(Mandatory)][string]$Name,
    [string]$Vault
  )

  if (Get-Command Get-SecretInfo -ErrorAction SilentlyContinue) {
    $arguments = @{ Name = $Name; ErrorAction = 'SilentlyContinue' }
    if ($Vault) { $arguments.Vault = $Vault }
    if (Get-SecretInfo @arguments) { return $true }
  }

  if (Import-CelebrateDealCredentialManagerIfAvailable) {
    return [bool](Get-StoredCredential -Target $Name)
  }

  return $false
}

function Set-CelebrateDealCredentialText {
  param(
    [Parameter(Mandatory)][string]$Name,
    [Parameter(Mandatory)][string]$Value,
    [string]$UserName = 'CelebrateDeal'
  )

  # Prefer the installed module when it can write successfully. Some releases
  # can read credentials under PowerShell 7 but fail to write them; the native
  # Windows Credential API below is the supported fallback.
  if (Import-CelebrateDealCredentialManagerIfAvailable -and (Get-Command New-StoredCredential -ErrorAction SilentlyContinue)) {
    try {
      New-StoredCredential -Target $Name -UserName $UserName -Password $Value -Type Generic -Persist LocalMachine -ErrorAction Stop | Out-Null
      if (Get-StoredCredential -Target $Name -ErrorAction SilentlyContinue) { return }
    }
    catch {
      # Continue to the native API without exposing the module's raw error.
    }
  }

  if (-not ('CelebrateDeal.NativeCredentialManager' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

namespace CelebrateDeal {
  public static class NativeCredentialManager {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct Credential {
      public UInt32 Flags;
      public UInt32 Type;
      public string TargetName;
      public string Comment;
      public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
      public UInt32 CredentialBlobSize;
      public IntPtr CredentialBlob;
      public UInt32 Persist;
      public UInt32 AttributeCount;
      public IntPtr Attributes;
      public string TargetAlias;
      public string UserName;
    }

    [DllImport("advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool CredWrite(ref Credential credential, UInt32 flags);
  }
}
'@
  }

  $secretBytes = [Text.Encoding]::Unicode.GetBytes($Value)
  $secretPointer = [IntPtr]::Zero
  try {
    $secretPointer = [Runtime.InteropServices.Marshal]::AllocCoTaskMem($secretBytes.Length)
    [Runtime.InteropServices.Marshal]::Copy($secretBytes, 0, $secretPointer, $secretBytes.Length)
    $credential = New-Object CelebrateDeal.NativeCredentialManager+Credential
    $credential.Type = 1
    $credential.TargetName = $Name
    $credential.CredentialBlobSize = $secretBytes.Length
    $credential.CredentialBlob = $secretPointer
    $credential.Persist = 2
    $credential.UserName = $UserName
    if (-not [CelebrateDeal.NativeCredentialManager]::CredWrite([ref]$credential, 0)) {
      throw 'Windows Credential Manager write failed.'
    }
  }
  finally {
    if ($secretPointer -ne [IntPtr]::Zero) {
      $zeroBytes = New-Object byte[] $secretBytes.Length
      [Runtime.InteropServices.Marshal]::Copy($zeroBytes, 0, $secretPointer, $zeroBytes.Length)
      [Runtime.InteropServices.Marshal]::FreeCoTaskMem($secretPointer)
      [Array]::Clear($zeroBytes, 0, $zeroBytes.Length)
    }
    [Array]::Clear($secretBytes, 0, $secretBytes.Length)
    $Value = $null
  }
}

function Test-CelebrateDealAgeRecipientFile {
  param([Parameter(Mandatory)][string]$Path)

  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
  $content = (Get-Content -LiteralPath $Path -Raw).Trim()
  return $content -match '(?m)^age1[023456789acdefghjklmnpqrstuvwxyz]+$' -and $content -notmatch 'replace_with'
}

function Test-CelebrateDealIsolationTarget {
  param(
    [Parameter(Mandatory)][string]$SourceSecretName,
    [Parameter(Mandatory)][string]$TargetSecretName,
    [string]$Vault
  )

  if (-not (Test-CelebrateDealSecretName -Name $SourceSecretName -Vault $Vault) -or -not (Test-CelebrateDealSecretName -Name $TargetSecretName -Vault $Vault)) {
    return 'missing'
  }

  $sourceText = $null
  $targetText = $null
  try {
    $sourceText = Get-CelebrateDealSecretText -Name $SourceSecretName -Vault $Vault
    $targetText = Get-CelebrateDealSecretText -Name $TargetSecretName -Vault $Vault
    $source = [uri]$sourceText
    $target = [uri]$targetText
    if ($source.Host -eq $target.Host -and $source.AbsolutePath -eq $target.AbsolutePath) { return 'same_target' }
    return 'isolated'
  }
  catch {
    return 'invalid'
  }
  finally {
    $sourceText = $null
    $targetText = $null
    [GC]::Collect()
  }
}

function Set-CelebrateDealPostgresEnvironment {
  param(
    [Parameter(Mandatory)][string]$ConnectionString,
    [switch]$AllowLocalNonTls
  )

  $uri = [uri]$ConnectionString
  if ($uri.Scheme -notin @('postgres', 'postgresql')) { throw 'Database secret must be a PostgreSQL connection URI.' }
  $separator = $uri.UserInfo.IndexOf(':')
  if ($separator -lt 1) { throw 'Database URI must include a username and password.' }

  $query = $uri.Query.TrimStart('?').Split('&') | Where-Object { $_ }
  $sslMode = 'require'
  foreach ($pair in $query) {
    $parts = $pair.Split('=', 2)
    if ($parts[0] -eq 'sslmode' -and $parts.Count -eq 2) { $sslMode = [uri]::UnescapeDataString($parts[1]) }
  }
  $isLoopback = $uri.Host -in @('localhost', '127.0.0.1', '::1')
  $tlsRequired = $sslMode -in @('require', 'verify-ca', 'verify-full')
  $localNonTlsAllowed = $AllowLocalNonTls -and $isLoopback -and $sslMode -eq 'disable'
  if (-not $tlsRequired -and -not $localNonTlsAllowed) { throw 'Database URI must require TLS.' }

  $newValues = @{
    PGHOST = $uri.Host
    PGPORT = if ($uri.IsDefaultPort) { '5432' } else { [string]$uri.Port }
    PGUSER = [uri]::UnescapeDataString($uri.UserInfo.Substring(0, $separator))
    PGPASSWORD = [uri]::UnescapeDataString($uri.UserInfo.Substring($separator + 1))
    PGDATABASE = $uri.AbsolutePath.Trim('/')
    PGSSLMODE = $sslMode
  }
  if ([string]::IsNullOrWhiteSpace($newValues.PGDATABASE)) { throw 'Database URI must include a database name.' }

  $previous = @{}
  foreach ($key in $newValues.Keys) {
    $previous[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
    [Environment]::SetEnvironmentVariable($key, $newValues[$key], 'Process')
  }
  return $previous
}

function Restore-CelebrateDealPostgresEnvironment {
  param([Parameter(Mandatory)][hashtable]$Previous)
  foreach ($key in $Previous.Keys) {
    [Environment]::SetEnvironmentVariable($key, $Previous[$key], 'Process')
  }
}

function Assert-CelebrateDealIsolatedTarget {
  param(
    [Parameter(Mandatory)][string]$SourceConnectionString,
    [Parameter(Mandatory)][string]$TargetConnectionString,
    [Parameter(Mandatory)][string]$Confirmation
  )
  if ($Confirmation -ne 'RESTORE-TO-ISOLATED-TARGET') { throw 'Explicit isolation confirmation is required.' }
  $source = [uri]$SourceConnectionString
  $target = [uri]$TargetConnectionString
  if ($source.Host -eq $target.Host -and $source.AbsolutePath -eq $target.AbsolutePath) {
    throw 'Restore target matches the Production source and is blocked.'
  }
  if ($target.Host -match 'production|prod') { throw 'Restore target hostname looks like Production and is blocked.' }
}

function Write-CelebrateDealBackupEvent {
  param(
    [Parameter(Mandatory)][string]$LogDirectory,
    [Parameter(Mandatory)][ValidateSet('success','failed','planned')][string]$Status,
    [Parameter(Mandatory)][string]$Stage,
    [string]$ArchiveId
  )
  New-Item -ItemType Directory -Path $LogDirectory -Force | Out-Null
  $event = [ordered]@{
    timestampUtc = [DateTime]::UtcNow.ToString('o')
    status = $Status
    stage = $Stage
    archiveId = $ArchiveId
  } | ConvertTo-Json -Compress
  Add-Content -LiteralPath (Join-Path $LogDirectory 'events.jsonl') -Value $event -Encoding utf8
}

function Get-CelebrateDealSafeFailureCategory {
  param([AllowEmptyString()][string]$RawOutput)

  # Provider command output may include connection metadata. Classify it only
  # in memory and never persist or return the original text.
  $text = ([string]$RawOutput).ToLowerInvariant()
  if ($text -match 'password authentication|authentication failed|password.*failed') { return 'authentication' }
  if ($text -match 'permission denied|must be owner|not authorized') { return 'authorization' }
  if ($text -match 'ssl|tls|certificate') { return 'tls' }
  if ($text -match 'timeout|could not connect|connection refused|could not translate host|network') { return 'network' }
  return 'unknown'
}

function Get-CelebrateDealRestoreFailureCategory {
  param([AllowEmptyString()][string]$RawOutput)

  $text = ([string]$RawOutput).ToLowerInvariant()
  if ($text -match 'password authentication|authentication failed|password.*failed') { return 'authentication' }
  if ($text -match 'permission denied|must be owner|not authorized') { return 'authorization' }
  if ($text -match 'ssl|tls|certificate') { return 'tls' }
  if ($text -match 'timeout|could not connect|connection refused|could not translate host|network') { return 'network' }
  if ($text -match 'role .* does not exist') { return 'role_compatibility' }
  if ($text -match 'extension .* is not available|could not open extension control file') { return 'extension_compatibility' }
  if ($text -match 'already exists|multiple primary keys|duplicate key') { return 'object_conflict' }
  if ($text -match 'errors ignored on restore|could not execute query') { return 'restore_objects' }
  return 'unknown'
}

function Copy-CelebrateDealGoogleDriveArchive {
  param(
    [Parameter(Mandatory)][string]$RclonePath,
    [Parameter(Mandatory)][string]$RcloneConfigPath,
    [Parameter(Mandatory)][string]$RemoteDestination,
    [Parameter(Mandatory)][string[]]$LocalFiles
  )
  if ($RemoteDestination -notmatch '^[^:\s]+:.+') { throw 'Google Drive destination must be an rclone remote path.' }
  if (-not (Test-Path -LiteralPath $RcloneConfigPath -PathType Leaf)) { throw 'rclone config file was not found.' }
  $sourceDirectory = Split-Path -Parent $LocalFiles[0]
  if ($LocalFiles | Where-Object { (Split-Path -Parent $_) -ne $sourceDirectory }) {
    throw 'Google Drive verification files must share one source directory.'
  }

  $fileManifest = [IO.Path]::GetTempFileName()
  try {
    foreach ($localFile in $LocalFiles) {
      $remoteFile = "$RemoteDestination/$([IO.Path]::GetFileName($localFile))"
      # The post-upload rclone check below is the integrity gate. Do not ask
      # copyto to pre-compare hashes: that breaks providers which defer hash
      # availability while accepting an otherwise valid upload.
      & $RclonePath '--config' $RcloneConfigPath 'copyto' $localFile $remoteFile '--retries' '3' '--low-level-retries' '1' '--log-level' 'ERROR' *> $null
      if ($LASTEXITCODE -ne 0) { throw 'Google Drive upload failed.' }
    }

    # Check only the current archive pair. --files-from plus --no-traverse
    # avoids enumerating the destination or touching older archives.
    Set-Content -LiteralPath $fileManifest -Value ($LocalFiles | ForEach-Object { [IO.Path]::GetFileName($_) }) -Encoding utf8
    & $RclonePath '--config' $RcloneConfigPath 'check' '--one-way' '--no-traverse' '--files-from' $fileManifest $sourceDirectory $RemoteDestination '--log-level' 'ERROR' *> $null
    if ($LASTEXITCODE -ne 0) { throw 'Google Drive checksum verification failed.' }
  }
  finally {
    Remove-Item -LiteralPath $fileManifest -Force -ErrorAction SilentlyContinue
  }
}

Export-ModuleMember -Function *
