[CmdletBinding()]
param([string]$RunId=('wp-52-m2-h20-supply-chain-static-'+(Get-Date -Format 'yyyyMMddHHmmssfff')))
$ErrorActionPreference='Stop'; Set-StrictMode -Version Latest
# Offline static inventory only: this script never invokes npm, Node, Git, Docker, or a workflow.
$root=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$inputs=@('docs/launch/m2-security-authorization-inventory-20260729.md','package.json','package-lock.json','.github/workflows/ci.yml')
$outDir=Join-Path $root ('.ai-team\reports\'+$RunId);$out=Join-Path $outDir 'final-runner-summary.sanitized.json'
if(Test-Path $outDir){throw 'Report directory exists'};New-Item -ItemType Directory -Path $outDir -Force|Out-Null
try {
  $files=@();foreach($rel in $inputs){$path=Join-Path $root $rel;if(-not(Test-Path -LiteralPath $path -PathType Leaf)){throw "Missing fixed input: $rel"};$files += [ordered]@{path=($rel-replace '\\','/');sha256=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash}}
  $h20=Get-Content (Join-Path $root $inputs[0])-Raw;if($h20 -notmatch 'M2-H20'){throw 'M2-H20 definition absent'}
  $pkg=Get-Content (Join-Path $root 'package.json')-Raw|ConvertFrom-Json
  Add-Type -AssemblyName System.Web.Extensions
  $serializer=New-Object System.Web.Script.Serialization.JavaScriptSerializer
  $serializer.MaxJsonLength=67108864
  $lock=$serializer.DeserializeObject((Get-Content (Join-Path $root 'package-lock.json')-Raw))
  if($lock.lockfileVersion -ne 3 -or -not $lock.packages.ContainsKey('')){throw 'Unsupported lockfile schema'}
  $rootLock=$lock.packages[''];$declared=@{};foreach($group in @($pkg.dependencies,$pkg.devDependencies)){if($null -ne $group){foreach($p in $group.PSObject.Properties){$declared[$p.Name]=[string]$p.Value}}}
  $rootMapped=0;foreach($name in $declared.Keys){if($rootLock.dependencies.ContainsKey($name)-or $rootLock.devDependencies.ContainsKey($name)){$rootMapped++}else{throw "Root dependency missing lock mapping: $name"}}
  $counts=[ordered]@{registryHttps=0;gitOrGithub=0;localLink=0;httpOrUnknown=0;missingIntegrity=0;installLifecycle=0;packageCount=0}
  foreach($key in $lock.packages.Keys){if($key -eq ''){continue};$entry=$lock.packages[$key];$counts.packageCount++;$resolved=if($entry.ContainsKey('resolved')){[string]$entry['resolved']}else{''};if($resolved -match '^https://'){$counts.registryHttps++}elseif($resolved -match '^(git\+|git:|github:|ssh:)'){$counts.gitOrGithub++}elseif($resolved -match '^(file:|link:|workspace:)'){$counts.localLink++}else{$counts.httpOrUnknown++};if(-not $entry.ContainsKey('integrity')){$counts.missingIntegrity++};if($entry.ContainsKey('hasInstallScript') -and $entry['hasInstallScript']){$counts.installLifecycle++}}
  $workflow=Get-Content (Join-Path $root '.github/workflows/ci.yml')-Raw
  $actionRefs=[regex]::Matches($workflow,'(?m)^\s*uses:\s*([^\s#]+)')|ForEach-Object{$_.Groups[1].Value};$pinned=@($actionRefs|Where-Object{$_ -match '@[0-9a-fA-F]{40}$'}).Count
  $secrets=[regex]::Matches($workflow,'secrets\.').Count
  $integrityStatus=$(if($counts.missingIntegrity -eq 0){'COMPLETE'}else{'GAPS_PRESENT'})
  $nonRegistryStatus=$(if(($counts.gitOrGithub+$counts.localLink+$counts.httpOrUnknown)-eq 0){'NONE'}else{'INVENTORIED'})
  $summary=[ordered]@{workPackage='WP-52 M2-H20 Supply-Chain Static Evidence Inventory';runId=$RunId;executionLedger=[ordered]@{NPM_EXECUTED='NO';NODE_EXECUTED='NO';GIT_EXECUTED='NO';DOCKER_EXECUTED='NO';NETWORK_REQUESTED='NO';ENV_OR_NPMRC_ACCESSED='NO';CHILD_PROCESS_STARTED='NO'};inputs=$files;rootDependencyMapping=[ordered]@{declared=$declared.Count;mapped=$rootMapped};lockfile=[ordered]@{version=$lock.lockfileVersion;overridesPresent=($null -ne $pkg.overrides);counts=$counts};ci=[ordered]@{workflow='.github/workflows/ci.yml';npmCiCount=([regex]::Matches($workflow,'(?m)\bnpm ci\b').Count);npmInstallCount=([regex]::Matches($workflow,'(?m)\bnpm install\b').Count);actionRefs=$actionRefs.Count;shaPinnedActions=$pinned;explicitPermissions=($workflow -match '(?m)^permissions:');secretsReferenceCount=$secrets};evidenceClassification=[ordered]@{STATIC_SUPPLY_CHAIN_COLLECTION='PASS';LOCKFILE_CONSISTENCY='PASS';INTEGRITY_METADATA_COVERAGE=$integrityStatus;NON_REGISTRY_DEPENDENCIES=$nonRegistryStatus;LIFECYCLE_SCRIPT_INVENTORY='COMPLETE';CI_ACTION_PINNING_INVENTORY='COMPLETE';VULNERABILITY_FRESHNESS='NOT_EVALUATED_OFFLINE';LICENSE_COMPLIANCE='NOT_EVALUATED';PACKAGE_SIGNATURE_PROVENANCE='NOT_EVALUATED';REGISTRY_AUTH_CONFIGURATION='NOT_READ_POLICY';M2_H20_STATUS='PARTIAL_STATIC_EVIDENCE';G1_STATUS='BLOCKED';READINESS_SCORE_CHANGE=0};unsupportedInferenceCount=0}
  $summary|ConvertTo-Json -Depth 8|Set-Content -LiteralPath $out -Encoding UTF8;Write-Output $out
}catch{if(Test-Path $outDir){Remove-Item -LiteralPath $outDir -Recurse -Force};throw}
