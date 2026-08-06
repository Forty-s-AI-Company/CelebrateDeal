[CmdletBinding()]
param(
    [string]$RunId = ('wp-84-m2-g1-acceptance-ledger-' + (Get-Date -Format 'yyyyMMddHHmmssfff'))
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# WP-84 is intentionally static: it reads only the exact sanitized evidence
# listed below and writes a run-scoped sanitized ledger. It never invokes prior
# runners or product tooling.
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$reportRootValidated = $false
if ($RunId -cnotmatch '^wp-84-m2-g1-acceptance-ledger-[0-9]{17}$') {
    throw 'RunId must match the exact WP-84 prefix followed by 17 digits.'
}
$reportsRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRoot '.ai-team\reports'))
$reportRoot = [System.IO.Path]::GetFullPath((Join-Path $reportsRoot $RunId))
$reportParent = [System.IO.Path]::GetDirectoryName($reportRoot)
$reportLeaf = [System.IO.Path]::GetFileName($reportRoot)
if ($reportRoot.Equals($reportsRoot, [System.StringComparison]::OrdinalIgnoreCase) -or
    -not $reportParent.Equals($reportsRoot, [System.StringComparison]::OrdinalIgnoreCase) -or
    $reportLeaf -cne $RunId) {
    throw 'Report path must be the validated direct child of the WP-84 reports root.'
}
$reportRootValidated = $true
$summaryPath = Join-Path $reportRoot 'final-runner-summary.sanitized.json'
$manifestPath = Join-Path $reportRoot 'input-manifest.sanitized.json'
$ledgerPath = Join-Path $reportRoot 'acceptance-ledger.sanitized.json'

$acceptedEvidence = @(
    [ordered]@{ wp = 27; path = '.ai-team/reports/wp-27-schema-cleanup-identity-20260729/checkpoint.sanitized.json'; kind = 'REPORT_CHECKPOINT' }
    [ordered]@{ wp = 28; path = '.ai-team/reports/wp-28-accountant-manager-direct-url-20260729/checkpoint.sanitized.json'; kind = 'REPORT_CHECKPOINT' }
    [ordered]@{ wp = 29; path = '.ai-team/reports/wp-29-admin-manager-direct-url-20260729/checkpoint.sanitized.json'; kind = 'REPORT_CHECKPOINT' }
    [ordered]@{ wp = 30; path = '.ai-team/reports/wp-30-accountant-platform-admin-direct-url-20260729/checkpoint.sanitized.json'; kind = 'REPORT_CHECKPOINT' }
    [ordered]@{ wp = 31; path = '.ai-team/reports/wp-31-admin-cross-tenant-product-edit-20260729/checkpoint.sanitized.json'; kind = 'REPORT_CHECKPOINT' }
    [ordered]@{ wp = 32; path = '.ai-team/reports/wp-32-admin-cross-tenant-form-submissions-20260729/checkpoint.sanitized.json'; kind = 'REPORT_CHECKPOINT' }
    [ordered]@{ wp = 33; path = '.ai-team/reports/wp-33-accountant-forms-new-direct-url-20260729/checkpoint.sanitized.json'; kind = 'REPORT_CHECKPOINT' }
    [ordered]@{ wp = 34; path = '.ai-team/reports/wp-34-admin-cross-tenant-form-edit-20260729/checkpoint.sanitized.json'; kind = 'REPORT_CHECKPOINT' }
    [ordered]@{ wp = 35; path = '.ai-team/reports/wp-35-admin-forms-index-tenant-isolation-20260729/checkpoint.sanitized.json'; kind = 'REPORT_CHECKPOINT' }
    [ordered]@{ wp = 36; path = '.ai-team/reports/wp-36-admin-cross-tenant-affiliate-edit-20260729/checkpoint.sanitized.json'; kind = 'REPORT_CHECKPOINT' }
    [ordered]@{ wp = 37; path = '.ai-team/reports/wp-37-owner-cross-tenant-message-template-edit-20260729/checkpoint.sanitized.json'; kind = 'REPORT_CHECKPOINT' }
    [ordered]@{ wp = 38; path = '.ai-team/reports/wp-38-owner-blacklist-index-tenant-isolation-20260729/checkpoint.sanitized.json'; kind = 'REPORT_CHECKPOINT' }
    [ordered]@{ wp = 39; path = '.ai-team/reports/wp-39-owner-cross-tenant-live-analytics-20260729/checkpoint.sanitized.json'; kind = 'REPORT_CHECKPOINT' }
    [ordered]@{ wp = 40; path = '.ai-team/reports/wp-40-admin-cross-tenant-video-edit-20260729/checkpoint.sanitized.json'; kind = 'REPORT_CHECKPOINT' }
    [ordered]@{ wp = 41; path = '.ai-team/reports/wp-41-admin-cross-tenant-live-preview-20260729/checkpoint.sanitized.json'; kind = 'REPORT_CHECKPOINT' }
    [ordered]@{ wp = 42; path = '.ai-team/reports/wp-42-admin-cross-tenant-interaction-script-edit-20260729/checkpoint.sanitized.json'; kind = 'REPORT_CHECKPOINT' }
    [ordered]@{ wp = 43; path = '.ai-team/reports/wp-43-accountant-foreign-interaction-role-direct-url-20260729/checkpoint.sanitized.json'; kind = 'REPORT_CHECKPOINT' }
    [ordered]@{ wp = 44; path = '.ai-team/reports/wp-44-accountant-foreign-product-edit-direct-url-20260729/checkpoint.sanitized.json'; kind = 'REPORT_CHECKPOINT' }
    [ordered]@{ wp = 45; path = '.ai-team/reports/wp-45-accountant-foreign-video-edit-direct-url-20260729/checkpoint.sanitized.json'; kind = 'REPORT_CHECKPOINT' }
    [ordered]@{ wp = 46; path = '.ai-team/reports/wp-46-accountant-foreign-live-edit-direct-url-20260729/checkpoint.sanitized.json'; kind = 'REPORT_CHECKPOINT' }
    [ordered]@{ wp = 47; path = '.ai-team/reports/wp-47-accountant-foreign-affiliate-edit-direct-url-20260729/checkpoint.sanitized.json'; kind = 'REPORT_CHECKPOINT' }
    [ordered]@{ wp = 48; path = '.ai-team/reports/wp-48-accountant-foreign-message-template-edit-direct-url-20260729/checkpoint.sanitized.json'; kind = 'REPORT_CHECKPOINT' }
    [ordered]@{ wp = 50; path = '.ai-team/reports/wp-50-m2-g1-evidence-reconciliation-20260729230313565/acceptance.sanitized.json'; kind = 'ACCEPTANCE_JSON' }
    [ordered]@{ wp = 52; path = '.ai-team/reports/wp-52-m2-h20-supply-chain-static-20260729231823533/acceptance.sanitized.json'; kind = 'ACCEPTANCE_JSON' }
)

foreach ($id in 58..83) {
    $acceptedEvidence += [ordered]@{
        wp = $id
        path = ".ai-team/state/wp-$id-checkpoint.json"
        kind = 'STATE_CHECKPOINT'
    }
}

$runtimeOnlyEvidence = @(
    [ordered]@{ wp = 53; path = '.ai-team/reports/wp-53-team-template-foreign-webinar-publish-boundary-20260729161752598/final-runner-summary.sanitized.json' }
    [ordered]@{ wp = 54; path = '.ai-team/reports/wp-54-accountant-form-edit-direct-url-20260729162829578/final-runner-summary.sanitized.json' }
    [ordered]@{ wp = 55; path = '.ai-team/reports/wp-55-accountant-form-submissions-direct-url-20260729164237276/final-runner-summary.sanitized.json' }
    [ordered]@{ wp = 56; path = '.ai-team/reports/wp-56-accountant-live-analytics-direct-url-20260730010145889/final-runner-summary.sanitized.json' }
    [ordered]@{ wp = 57; path = '.ai-team/reports/wp-57-accountant-tracking-settings-direct-url-20260730010911714/final-runner-summary.sanitized.json' }
)

$secondaryEvidence = @(
    [ordered]@{ path = '.ai-team/reports/wp-25-webinar-owner-boundary-20260729101330072/final-runner-summary.sanitized.json'; tier = 'RUNTIME_SECONDARY' }
    [ordered]@{ path = '.ai-team/reports/wp-50-m2-g1-evidence-reconciliation-20260729230313565/final-runner-summary.sanitized.json'; tier = 'RECONCILIATION_SECONDARY' }
    [ordered]@{ path = '.ai-team/reports/wp-51-wp25-evidence-conflict-20260729231040917/conflict-evidence.sanitized.json'; tier = 'CONFLICT_AUTHORITY' }
    [ordered]@{ path = '.ai-team/reports/wp-52-m2-h20-supply-chain-static-20260729231823533/final-runner-summary.sanitized.json'; tier = 'RECONCILIATION_SECONDARY' }
)

function Get-SanitizedEvidence {
    param(
        [Parameter(Mandatory = $true)][string]$RelativePath,
        [Parameter(Mandatory = $true)][string]$AuthorityTier
    )

    $isApprovedStateCheckpoint = (
        $AuthorityTier -eq 'STATE_CHECKPOINT' -and
        $RelativePath -match '^\.ai-team/state/wp-(?:5[8-9]|6[0-9]|7[0-9]|8[0-3])-checkpoint\.json$'
    )
    if ($RelativePath -notmatch '\.sanitized\.json$' -and -not $isApprovedStateCheckpoint) {
        throw "Non-sanitized evidence rejected: $RelativePath"
    }
    if ([System.IO.Path]::IsPathRooted($RelativePath) -or $RelativePath -match '(^|[\\/])\.\.([\\/]|$)') {
        throw "Unsafe evidence path rejected: $RelativePath"
    }

    $fullPath = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $RelativePath))
    $repoPrefix = $repoRoot.TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
    if (-not $fullPath.StartsWith($repoPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Evidence path escaped repository: $RelativePath"
    }
    if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
        throw "Missing evidence: $RelativePath"
    }

    try {
        $content = Get-Content -LiteralPath $fullPath -Raw | ConvertFrom-Json
    }
    catch {
        throw "Invalid sanitized JSON: $RelativePath"
    }

    return [ordered]@{
        content = $content
        manifest = [ordered]@{
            path = ($RelativePath -replace '\\', '/')
            sha256 = (Get-FileHash -LiteralPath $fullPath -Algorithm SHA256).Hash
            authorityTier = $AuthorityTier
        }
    }
}

function Get-StateAcceptance {
    param([Parameter(Mandatory = $true)]$Checkpoint)

    if ($Checkpoint.PSObject.Properties['sol_acceptance']) {
        return [string]$Checkpoint.sol_acceptance
    }
    if ($Checkpoint.PSObject.Properties['work_package'] -and
        $Checkpoint.work_package -isnot [string] -and
        $Checkpoint.work_package.PSObject.Properties['sol_acceptance']) {
        return [string]$Checkpoint.work_package.sol_acceptance
    }
    return ''
}

if (Test-Path -LiteralPath $reportRoot) {
    throw "Report directory already exists: $reportRoot"
}
New-Item -ItemType Directory -Path $reportRoot | Out-Null

try {
    $rowsByWp = @{}
    foreach ($id in 25..83) {
        $rowsByWp[$id] = [ordered]@{
            wp = "WP-$id"
            classification = 'NOT_EVALUATED'
            authority = 'NONE'
            evidencePath = $null
            evidenceSha256 = $null
            acceptanceField = $null
            note = 'No allowlisted canonical acceptance authority was available to WP-84.'
        }
    }

    $manifest = @()

    foreach ($entry in $acceptedEvidence) {
        if ($rowsByWp[$entry.wp].classification -ne 'NOT_EVALUATED') {
            throw "Duplicate ledger authority for WP-$($entry.wp)"
        }
        $evidence = Get-SanitizedEvidence -RelativePath $entry.path -AuthorityTier $entry.kind
        $manifest += $evidence.manifest

        $acceptance = ''
        switch ($entry.kind) {
            'REPORT_CHECKPOINT' {
                $acceptance = [string]$evidence.content.status
                if ($acceptance -notin @('ACCEPTED', 'SOL_ACCEPTED')) {
                    throw "Report checkpoint lacks accepted verdict: WP-$($entry.wp)"
                }
            }
            'ACCEPTANCE_JSON' {
                $acceptance = [string]$evidence.content.acceptanceDecision
                if ($acceptance -ne 'ACCEPT') {
                    throw "Acceptance JSON lacks ACCEPT: WP-$($entry.wp)"
                }
            }
            'STATE_CHECKPOINT' {
                $acceptance = Get-StateAcceptance -Checkpoint $evidence.content
                if ($acceptance -ne 'ACCEPT') {
                    throw "State checkpoint lacks ACCEPT: WP-$($entry.wp)"
                }
            }
            default {
                throw "Unknown authority kind: $($entry.kind)"
            }
        }

        $rowsByWp[$entry.wp] = [ordered]@{
            wp = "WP-$($entry.wp)"
            classification = 'CANONICAL_ACCEPTED'
            authority = $entry.kind
            evidencePath = $evidence.manifest.path
            evidenceSha256 = $evidence.manifest.sha256
            acceptanceField = $acceptance
            note = 'Explicit canonical acceptance metadata is present; this does not imply full route-matrix closure.'
        }
    }

    foreach ($entry in $runtimeOnlyEvidence) {
        if ($rowsByWp[$entry.wp].classification -ne 'NOT_EVALUATED') {
            throw "Runtime evidence would overwrite authority for WP-$($entry.wp)"
        }
        $evidence = Get-SanitizedEvidence -RelativePath $entry.path -AuthorityTier 'RUNTIME_SECONDARY'
        $manifest += $evidence.manifest
        $rowsByWp[$entry.wp] = [ordered]@{
            wp = "WP-$($entry.wp)"
            classification = 'RUNTIME_ONLY'
            authority = 'RUNTIME_SECONDARY'
            evidencePath = $evidence.manifest.path
            evidenceSha256 = $evidence.manifest.sha256
            acceptanceField = $null
            note = 'Runtime artifact exists, but no allowlisted canonical acceptance metadata is available.'
        }
    }

    foreach ($entry in $secondaryEvidence) {
        $evidence = Get-SanitizedEvidence -RelativePath $entry.path -AuthorityTier $entry.tier
        $manifest += $evidence.manifest
        if ($entry.tier -eq 'CONFLICT_AUTHORITY') {
            $classification = $evidence.content.classification
            if ([string]$classification.WP25_ACCEPTANCE_STATUS -ne 'UNPROVEN' -or
                [string]$classification.WP25_EVIDENCE_CLASSIFICATION -ne 'CONFLICT_OR_STALE' -or
                [string]$classification.G1_STATUS -ne 'BLOCKED') {
                throw 'WP-51 conflict authority no longer proves the required WP-25 conflict.'
            }
            $rowsByWp[25] = [ordered]@{
                wp = 'WP-25'
                classification = 'CONFLICT'
                authority = 'CONFLICT_AUTHORITY'
                evidencePath = $evidence.manifest.path
                evidenceSha256 = $evidence.manifest.sha256
                acceptanceField = 'UNPROVEN'
                note = 'WP-51 confirms aliased runtime evidence and no canonical WP-25 acceptance checkpoint.'
            }
        }
    }

    $rows = @(25..83 | ForEach-Object { $rowsByWp[$_] })
    $allowedClassifications = @('CANONICAL_ACCEPTED', 'RUNTIME_ONLY', 'CONFLICT', 'NOT_EVALUATED')
    if ($rows.Count -ne 59) { throw "Expected 59 ledger rows, got $($rows.Count)." }
    if (@($rows.wp | Select-Object -Unique).Count -ne 59) { throw 'Ledger WP identifiers are not unique.' }
    if (@($rows | Where-Object { $_.classification -notin $allowedClassifications }).Count -ne 0) {
        throw 'Ledger contains an unsupported classification.'
    }
    if ($rowsByWp[25].classification -ne 'CONFLICT') { throw 'WP-25 must remain CONFLICT.' }
    foreach ($id in 53..57) {
        if ($rowsByWp[$id].classification -ne 'RUNTIME_ONLY') {
            throw "WP-$id must remain RUNTIME_ONLY."
        }
    }
    foreach ($row in $rows | Where-Object { $_.classification -eq 'CANONICAL_ACCEPTED' }) {
        if (-not $row.acceptanceField -or -not $row.evidenceSha256) {
            throw "Accepted row lacks explicit authority: $($row.wp)"
        }
    }

    $counts = [ordered]@{}
    foreach ($classification in $allowedClassifications) {
        $counts[$classification] = @($rows | Where-Object classification -eq $classification).Count
    }
    if (($counts.Values | Measure-Object -Sum).Sum -ne 59) {
        throw 'Ledger classification counts do not total 59.'
    }

    $executionLedger = [ordered]@{
        priorRunnerInvoked = $false
        childProcessStarted = $false
        environmentFileAccessed = $false
        databaseConnected = $false
        browserStarted = $false
        networkRequested = $false
        externalServiceAccessed = $false
    }

    $ledger = [ordered]@{
        workPackage = 'WP-84'
        runId = $RunId
        authorityRule = 'Only explicit ACCEPT, ACCEPTED, or SOL_ACCEPTED metadata may produce CANONICAL_ACCEPTED.'
        rows = $rows
    }
    $ledger | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $ledgerPath -Encoding UTF8

    $manifestPaths = @($manifest | ForEach-Object { [string]$_['path'] })
    if (@($manifestPaths | Select-Object -Unique).Count -ne $manifestPaths.Count) {
        throw 'Input manifest contains duplicate evidence paths.'
    }
    $manifestDocument = [ordered]@{
        workPackage = 'WP-84'
        runId = $RunId
        inputs = @($manifest | Sort-Object { [string]$_['path'] })
    }
    $manifestDocument | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $manifestPath -Encoding UTF8

    $summary = [ordered]@{
        workPackage = 'WP-84 M2/G1 Canonical Acceptance Ledger after WP-83'
        runId = $RunId
        finalRunnerError = $null
        executionLedger = $executionLedger
        rowCount = $rows.Count
        classifications = $counts
        gates = [ordered]@{
            G1 = 'BLOCKED'
            M2_A02_COMPLETENESS = 'INDETERMINATE'
            READINESS_SCORE_CHANGE = 0
            NEXT_LOCAL_TARGET = 'WP-85_ISOLATED_WP25_REVERIFICATION'
        }
        limitations = @(
            'Canonical acceptance of narrow work packages does not establish complete route-role coverage.',
            'Runtime-only evidence was not promoted to canonical acceptance.',
            'Decision, external, manual, and production work was not executed.'
        )
        outputs = [ordered]@{
            ledger = 'acceptance-ledger.sanitized.json'
            inputManifest = 'input-manifest.sanitized.json'
        }
    }
    $summary | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $summaryPath -Encoding UTF8
    Write-Output $reportRoot
}
catch {
    if ($reportRootValidated -and
        $reportParent.Equals($reportsRoot, [System.StringComparison]::OrdinalIgnoreCase) -and
        $reportLeaf -ceq $RunId -and
        (Test-Path -LiteralPath $reportRoot)) {
        Remove-Item -LiteralPath $reportRoot -Recurse -Force
    }
    throw
}
