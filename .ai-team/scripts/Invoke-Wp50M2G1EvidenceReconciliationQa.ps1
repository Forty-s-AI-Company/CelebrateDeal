[CmdletBinding()]
param(
    [string]$RunId = ('wp-50-m2-g1-evidence-reconciliation-' + (Get-Date -Format 'yyyyMMddHHmmssfff'))
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# This runner is deliberately static.  It never invokes prior runners, tests,
# database tooling, or external services; it reads only fixed sanitized evidence.
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$reportRoot = Join-Path $repoRoot ('.ai-team\reports\' + $RunId)
$reportPath = Join-Path $reportRoot 'final-runner-summary.sanitized.json'
$inventoryPath = Join-Path $repoRoot 'docs\launch\m2-security-authorization-inventory-20260729.md'
$evidenceIndexPath = Join-Path $repoRoot 'docs\launch\evidence-index.md'
$masterPlanPath = Join-Path $repoRoot 'docs\ai-team\master-execution-plan.md'
$wp25Path = Join-Path $repoRoot '.ai-team\reports\wp-25-webinar-owner-boundary-20260729101330072\final-runner-summary.sanitized.json'
$wp49AcceptancePath = Join-Path $repoRoot '.ai-team\reports\wp-49-backup-plan-only-static-20260729225247786\acceptance.sanitized.json'

$checkpointPaths = [ordered]@{
    'WP-27' = '.ai-team/reports/wp-27-schema-cleanup-identity-20260729/checkpoint.sanitized.json'
    'WP-28' = '.ai-team/reports/wp-28-accountant-manager-direct-url-20260729/checkpoint.sanitized.json'
    'WP-29' = '.ai-team/reports/wp-29-admin-manager-direct-url-20260729/checkpoint.sanitized.json'
    'WP-30' = '.ai-team/reports/wp-30-accountant-platform-admin-direct-url-20260729/checkpoint.sanitized.json'
    'WP-31' = '.ai-team/reports/wp-31-admin-cross-tenant-product-edit-20260729/checkpoint.sanitized.json'
    'WP-32' = '.ai-team/reports/wp-32-admin-cross-tenant-form-submissions-20260729/checkpoint.sanitized.json'
    'WP-33' = '.ai-team/reports/wp-33-accountant-forms-new-direct-url-20260729/checkpoint.sanitized.json'
    'WP-34' = '.ai-team/reports/wp-34-admin-cross-tenant-form-edit-20260729/checkpoint.sanitized.json'
    'WP-35' = '.ai-team/reports/wp-35-admin-forms-index-tenant-isolation-20260729/checkpoint.sanitized.json'
    'WP-36' = '.ai-team/reports/wp-36-admin-cross-tenant-affiliate-edit-20260729/checkpoint.sanitized.json'
    'WP-37' = '.ai-team/reports/wp-37-owner-cross-tenant-message-template-edit-20260729/checkpoint.sanitized.json'
    'WP-38' = '.ai-team/reports/wp-38-owner-blacklist-index-tenant-isolation-20260729/checkpoint.sanitized.json'
    'WP-39' = '.ai-team/reports/wp-39-owner-cross-tenant-live-analytics-20260729/checkpoint.sanitized.json'
    'WP-40' = '.ai-team/reports/wp-40-admin-cross-tenant-video-edit-20260729/checkpoint.sanitized.json'
    'WP-41' = '.ai-team/reports/wp-41-admin-cross-tenant-live-preview-20260729/checkpoint.sanitized.json'
    'WP-42' = '.ai-team/reports/wp-42-admin-cross-tenant-interaction-script-edit-20260729/checkpoint.sanitized.json'
    'WP-43' = '.ai-team/reports/wp-43-accountant-foreign-interaction-role-direct-url-20260729/checkpoint.sanitized.json'
    'WP-44' = '.ai-team/reports/wp-44-accountant-foreign-product-edit-direct-url-20260729/checkpoint.sanitized.json'
    'WP-45' = '.ai-team/reports/wp-45-accountant-foreign-video-edit-direct-url-20260729/checkpoint.sanitized.json'
    'WP-46' = '.ai-team/reports/wp-46-accountant-foreign-live-edit-direct-url-20260729/checkpoint.sanitized.json'
    'WP-47' = '.ai-team/reports/wp-47-accountant-foreign-affiliate-edit-direct-url-20260729/checkpoint.sanitized.json'
    'WP-48' = '.ai-team/reports/wp-48-accountant-foreign-message-template-edit-direct-url-20260729/checkpoint.sanitized.json'
}

function Get-SanitizedJson {
    param([string]$FullPath)
    if ($FullPath -notmatch '\.sanitized\.json$') { throw "Non-sanitized evidence path rejected: $FullPath" }
    if (-not (Test-Path -LiteralPath $FullPath -PathType Leaf)) { throw "Missing evidence: $FullPath" }
    try { return Get-Content -LiteralPath $FullPath -Raw | ConvertFrom-Json }
    catch { throw "Invalid sanitized JSON: $FullPath" }
}

function Get-FileRecord {
    param([string]$FullPath)
    $relative = $FullPath.Substring($repoRoot.Length).TrimStart('\','/') -replace '\\','/'
    return [ordered]@{ path = $relative; sha256 = (Get-FileHash -LiteralPath $FullPath -Algorithm SHA256).Hash }
}

if (Test-Path -LiteralPath $reportRoot) { throw "Report directory already exists: $reportRoot" }
New-Item -ItemType Directory -Path $reportRoot -Force | Out-Null

try {
    # The evidence index is the explicit authority that binds the one master plan.
    $indexText = Get-Content -LiteralPath $evidenceIndexPath -Raw
    $masterReferenceCount = [regex]::Matches($indexText, 'docs/ai-team/master-execution-plan\.md').Count
    if ($masterReferenceCount -ne 1 -or -not (Test-Path -LiteralPath $masterPlanPath)) {
        throw 'Master plan is not uniquely referenced by the evidence index.'
    }
    $inventoryText = Get-Content -LiteralPath $inventoryPath -Raw
    $masterPlanText = Get-Content -LiteralPath $masterPlanPath -Raw
    $candidateIds = @([regex]::Matches($inventoryText, '\b(M2-(?:H\d{2}|A\d{2}))\b') | ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique)
    if ($candidateIds.Count -ne 26) { throw "Unexpected M2 candidate count: $($candidateIds.Count)" }
    if (@($candidateIds | Select-Object -Unique).Count -ne 26) { throw 'Duplicate M2 candidate id.' }

    $acceptedCells = @()
    foreach ($entry in $checkpointPaths.GetEnumerator()) {
        $fullPath = Join-Path $repoRoot $entry.Value
        $checkpoint = Get-SanitizedJson -FullPath $fullPath
        $status = [string]$checkpoint.status
        if ($status -notin @('ACCEPTED', 'SOL_ACCEPTED')) { throw "Checkpoint lacks accepted verdict: $($entry.Key)" }
        $record = Get-FileRecord -FullPath $fullPath
        $acceptanceProperty = $checkpoint.PSObject.Properties['acceptance']
        $provenCellProperty = $checkpoint.PSObject.Properties['proven_cell']
        $assertion = if ($null -ne $acceptanceProperty -and $acceptanceProperty.Value) { [string]$acceptanceProperty.Value } elseif ($null -ne $provenCellProperty) { 'single direct-URL role-route cell recorded' } else { 'accepted narrow authorization evidence' }
        $acceptedCells += [ordered]@{ wp = $entry.Key; checkpoint = $record.path; sha256 = $record.sha256; assertion = $assertion; nonCoverage = 'Does not by itself establish the full M2-A02 route-role matrix.' }
    }

    $wp25 = Get-SanitizedJson -FullPath $wp25Path
    if ($wp25.work_package -ne 'WP-25' -or $wp25.final_runner_error) { throw 'WP-25 runtime evidence is invalid.' }
    $wp25Record = Get-FileRecord -FullPath $wp25Path
    $wp49 = Get-SanitizedJson -FullPath $wp49AcceptancePath
    if ($wp49.acceptanceDecision -ne 'ACCEPT' -or $wp49.gate.status -ne 'WAITING_AUTHORIZATION') { throw 'WP-49 acceptance linkage is invalid.' }
    $wp49Record = Get-FileRecord -FullPath $wp49AcceptancePath

    $classifications = @()
    foreach ($id in $candidateIds) {
        $classification = 'PARTIAL'
        $detail = 'Inventory has current-state evidence, but this WP does not infer new canonical acceptance beyond explicitly linked evidence.'
        $evidence = @()
        switch ($id) {
            'M2-A01' {
                $classification = if ($inventoryText -match '(?s)M2-A01.*?\|\s*WP-25 only') { 'CONFLICT_OR_STALE' } else { 'PARTIAL' }
                $detail = 'WP-25 runtime artifacts exist, but canonical Sol acceptance checkpoint is missing (EVIDENCE_PRESENT_ACCEPTANCE_UNPROVEN).'
                $evidence = @([ordered]@{ wp='WP-25'; report=$wp25Record.path; sha256=$wp25Record.sha256; assertion='Synthetic Browser owner-boundary negative runtime evidence present.'; nonCoverage='Canonical acceptance is unproven; not counted as completed.' })
            }
            'M2-A02' {
                $classification = 'PARTIAL'
                $detail = 'WP-28 through WP-48 have accepted narrow cells; full role-route matrix remains unproven.'
                $evidence = @($acceptedCells)
            }
            'M2-A03' { $classification='DECISION_REQUIRED'; $detail='Analytics authenticity policy requires product owner decision.' }
            'M2-A04' { $classification='DECISION_REQUIRED'; $detail='Referral-proof semantics require product owner decision.' }
            'M2-A05' { $classification='DECISION_REQUIRED'; $detail='Public contact-email exposure requires product owner decision.' }
            'M2-A06' { $classification='DECISION_REQUIRED'; $detail='Vendor finance MFA rollout requires product owner decision.' }
            'M2-H16' { $classification='WAITING_AUTHORIZATION'; $detail='External Vercel environment operation is not authorized.' }
            'M2-H19' { $classification='WAITING_AUTHORIZATION'; $detail='Production key custody and rotation ceremony require owner authorization.' }
            'M2-H20' { $classification='LOCAL_NOT_COVERED'; $detail='Future local supply-chain evidence is not covered by WP-25 through WP-49.' }
        }
        $classifications += [ordered]@{ candidateId=$id; classification=$classification; detail=$detail; evidence=$evidence }
    }

    $unsupported = @($classifications | Where-Object { $_.classification -eq 'EVIDENCED_ACCEPTED' -and @($_.evidence).Count -eq 0 })
    if ($unsupported.Count -ne 0) { throw 'Unsupported accepted inference detected.' }
    $inputRecords = @((Get-FileRecord $inventoryPath), (Get-FileRecord $evidenceIndexPath), (Get-FileRecord $masterPlanPath), $wp25Record, $wp49Record)
    $inputRecords += @($acceptedCells | ForEach-Object { [ordered]@{ path=$_.checkpoint; sha256=$_.sha256 } })

    $summary = [ordered]@{
        workPackage = 'WP-50 M2/G1 Canonical Evidence Reconciliation'
        runId = $RunId
        executionLedger = [ordered]@{ TARGET_WP_EXECUTED='NO'; CHILD_PROCESS_STARTED='NO'; ENV_FILE_ACCESSED='NO'; DATABASE_CONNECTED='NO'; BACKUP_EXECUTED='NO'; NETWORK_REQUESTED='NO' }
        inputHashes = @($inputRecords)
        canonicalEvidence = [ordered]@{ wp25Status='EVIDENCE_PRESENT_ACCEPTANCE_UNPROVEN'; wp25CheckpointPresent=$false; wp27ToWp48AcceptedCheckpointCount=$acceptedCells.Count; wp49StaticOnlyAcceptance=$wp49Record }
        classifications = @($classifications)
        unsupportedInferenceCount = 0
        documentConflicts = @('Master execution plan remains at CURRENT_EXECUTABLE_WP: WP-24 while later sanitized WP evidence exists.', 'WP-25 runtime evidence exists without canonical acceptance checkpoint.')
        gates = [ordered]@{ G1='BLOCKED'; G1Reason='M2-A01 acceptance gap and M2-A02 full-matrix gap remain.'; G2='WAITING_AUTHORIZATION'; G3='NOT_EVALUATED'; G4='NOT_EVALUATED'; G5='NOT_EVALUATED'; G6='NOT_EVALUATED' }
        readinessEffect = 'No score change; reconciliation only.'
        nextLocalCandidate = [ordered]@{ candidate='M2-H20 supply-chain evidence'; status='LOCAL_NOT_COVERED'; note='Requires a new Sol-planned work package; not executed by WP-50.' }
    }
    $summary | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $reportPath -Encoding UTF8
    Write-Output $reportPath
}
catch {
    if (Test-Path -LiteralPath $reportRoot) { Remove-Item -LiteralPath $reportRoot -Recurse -Force }
    throw
}
