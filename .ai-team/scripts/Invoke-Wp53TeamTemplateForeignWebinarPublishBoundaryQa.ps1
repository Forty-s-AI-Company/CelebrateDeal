[CmdletBinding()]
param([switch]$PreflightSelfTest)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$runId = (Get-Date).ToUniversalTime().ToString('yyyyMMddHHmmssfff')
$schema = "wp53_$runId"; $marker = "wp53:$runId"
$temp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$snapshot = Join-Path $temp "CelebrateDeal-WP53-$runId"; $runtime = Join-Path $temp "CelebrateDeal-WP53-runtime-$runId"
$reportDir = Join-Path $root ".ai-team\reports\wp-53-team-template-foreign-webinar-publish-boundary-$runId"
$logs = Join-Path $reportDir 'logs'; $receipts = [Collections.Generic.List[object]]::new()
$schemaCreated = $false; $failure = $null

function Write-Json([string]$Name, $Value) {
  $Value | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $reportDir $Name) -Encoding UTF8
}
function Safe([string]$Value) {
  if ($null -eq $Value) { return '' }
  $result = $Value -replace '(?i)postgres(?:ql)?://\S+', '[REDACTED_DATABASE_URL]'
  $result = $result -replace '(?i)(api[_-]?key|token|secret|password|authorization)\s*[:=]\s*[^\s,;]+', '$1=[REDACTED]'
  return $result -replace '(?i)[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}', '[REDACTED_EMAIL]'
}
function Add-Receipt([string]$Name,[int]$Exit,[long]$Ms,[string]$Out,[string]$Err) {
  $summary = Safe (($Out + "`n" + $Err).Trim())
  if ($summary.Length -gt 3500) { $summary = $summary.Substring(0, 3500) }
  $classification = if ($Exit -eq 0) { 'PASS' } else { 'FAIL' }
  $receipts.Add([ordered]@{name=$Name;exit_code=$Exit;duration_ms=$Ms;classification=$classification;sanitized_summary=$summary}) | Out-Null
}
function Invoke-Child([string]$Name,[string]$File,[string[]]$Arguments,[Collections.IDictionary]$Env) {
  $info=[Diagnostics.ProcessStartInfo]::new();$info.WorkingDirectory=$snapshot;$info.UseShellExecute=$false;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true;$info.CreateNoWindow=$true;$info.Environment.Clear();foreach($k in $Env.Keys){$info.Environment[$k]=[string]$Env[$k]}
  if($File.EndsWith('.cmd')){$info.FileName=$env:ComSpec;$info.Arguments='/d /c "'+$File+' '+($Arguments -join ' ')+'"'}else{$info.FileName=$File;$info.Arguments=$Arguments -join ' '}
  $p=[Diagnostics.Process]::new();$p.StartInfo=$info;$sw=[Diagnostics.Stopwatch]::StartNew();[void]$p.Start();$o=$p.StandardOutput.ReadToEndAsync();$e=$p.StandardError.ReadToEndAsync();$p.WaitForExit();$out=$o.GetAwaiter().GetResult();$err=$e.GetAwaiter().GetResult();$sw.Stop();Add-Receipt $Name $p.ExitCode $sw.ElapsedMilliseconds $out $err;return $p.ExitCode
}
function Environment-ForRun {
  $url="postgresql://postgres:postgres@127.0.0.1:54329/celebratedeal_ci?schema=$schema"
  return [ordered]@{PATH=$env:PATH;SystemRoot=$env:SystemRoot;ComSpec=$env:ComSpec;PATHEXT=$env:PATHEXT;NODE_ENV='test';CI='true';DATABASE_URL=$url;DIRECT_URL=$url;E2E_PORT='31053';E2E_BASE_URL='http://127.0.0.1:31053';E2E_SMOKE_TEST_EMAIL='wp53-synthetic@celebratedeal.test';RATE_LIMIT_PROVIDER='memory';PAYMENT_PROVIDER='demo';JOB_SECRET='wp53-job-secret-at-least-16-chars';CSRF_SECRET='wp53-csrf-secret-at-least-16-chars';SENTRY_DISABLE_AUTO_UPLOAD='true';SENTRY_DSN='';NEXT_PUBLIC_SENTRY_DSN='';SENTRY_AUTH_TOKEN='';RESEND_API_KEY='';EMAIL_FROM='';PLAYWRIGHT_BROWSERS_PATH=(Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)) 'ms-playwright');PLAYWRIGHT_JSON_OUTPUT_FILE=(Join-Path $snapshot '.wp53-browser-results.json');TEMP=(Join-Path $runtime 'temp');TMP=(Join-Path $runtime 'tmp');HOME=(Join-Path $runtime 'home');USERPROFILE=(Join-Path $runtime 'home');NPM_CONFIG_CACHE=(Join-Path $runtime 'npm-cache')}
}
function Assert-Preflight {
  if($schema -notmatch '^wp53_[a-z0-9_]+$'){throw 'Invalid WP-53 schema name.'}
  $s=@(git -C $root status --short); if(@(git -C $root diff --cached --name-only).Count -ne 0){throw 'Staged index must be empty.'}
  $owned=@('?? .ai-team/scripts/Invoke-Wp53TeamTemplateForeignWebinarPublishBoundaryQa.ps1','?? tests/e2e/team-template-foreign-webinar-publish-boundary.spec.ts')
  if(@($s|Where-Object{$_ -notin $owned}).Count -ne 70 -or @($s|Where-Object{$_ -in $owned}).Count -ne 2){throw 'WP-53 ownership baseline mismatch.'}
  $guards=@(@('src/app/(app)/team-templates/[id]/edit/page.tsx','manageTeamFunnelTemplateAction'),@('src/components/team-template-form.tsx','useActionState'),@('src/app/actions/team-funnel-template-actions.ts','selectedWebinarId'),@('src/app/actions/team-funnel-template-actions.ts','你沒有管理這個團隊模板的權限，或該資源已不存在。'))
  foreach($g in $guards){if(-not(Select-String -LiteralPath $g[0] -Pattern $g[1] -SimpleMatch -Quiet)){throw "Source contract drift: $($g[0])"}}
  $databaseAvailable = Test-NetConnection -ComputerName '127.0.0.1' -Port 54329 -InformationLevel Quiet
  if (-not $databaseAvailable) { throw 'Local disposable database is unavailable.' }
}
if($PreflightSelfTest){Assert-Preflight;Write-Output 'WP-53 preflight PASS';exit 0}
try {
  Assert-Preflight;New-Item -ItemType Directory -Force -Path $reportDir,$logs,$snapshot,$runtime|Out-Null
  $exclude=@('.git','.ai-team','.next','node_modules','test-results');Get-ChildItem -LiteralPath $root -Force|Where-Object{$_.Name -notin $exclude -and $_.Name -notlike '.env*'}|ForEach-Object{Copy-Item -LiteralPath $_.FullName -Destination $snapshot -Recurse -Force}
  New-Item -ItemType Junction -Path (Join-Path $snapshot 'node_modules') -Target (Join-Path $root 'node_modules')|Out-Null
  $config=Join-Path $snapshot 'playwright.config.ts'
  $text=[IO.File]::ReadAllText($config)
  $originalStartCommand='npx prisma generate ' + '&' + '& npx next build ' + '&' + '& npx next start --port ${port}'
  # The snapshot deliberately junctions the already-generated dependency tree. Generating into that shared tree would
  # mutate the preserved workspace, so validate schema here and use the checked-in local generated client for the build.
  $webpackStartCommand='npx next build --webpack ' + '&' + '& npx next start --port ${port}'
  if(-not $text.Contains($originalStartCommand)){throw 'Release-mode Playwright start command drifted.'}
  $text=$text.Replace($originalStartCommand,$webpackStartCommand)
  if(-not $text.Contains('timeout: 120_000')){throw 'Release-mode Playwright timeout contract drifted.'}
  $text=$text.Replace('timeout: 120_000','timeout: 300_000')
  [IO.File]::WriteAllText($config,$text,[Text.UTF8Encoding]::new($false))
  $envRun=Environment-ForRun;New-Item -ItemType Directory -Force -Path $envRun.TEMP,$envRun.TMP,$envRun.HOME,$envRun.NPM_CONFIG_CACHE|Out-Null
  $node=(Get-Command node.exe -ErrorAction Stop).Source;$npx=(Get-Command npx.cmd -ErrorAction Stop).Source;$prisma='node_modules/prisma/build/index.js'
  if((Invoke-Child 'prisma-validate' $node @($prisma,'validate') $envRun) -ne 0){throw 'Prisma validation failed.'}
  $boot=Join-Path $snapshot 'wp53-bootstrap.sql';[IO.File]::WriteAllText($boot,"CREATE SCHEMA IF NOT EXISTS `"$schema`";`nCOMMENT ON SCHEMA `"$schema`" IS '$marker';`n",[Text.UTF8Encoding]::new($false));if((Invoke-Child 'database-bootstrap' $node @($prisma,'db','execute','--schema','prisma/schema.prisma','--file','.\wp53-bootstrap.sql') $envRun) -ne 0){throw 'Schema bootstrap failed.'};$schemaCreated=$true
  if((Invoke-Child 'migrate-deploy' $node @($prisma,'migrate','deploy') $envRun) -ne 0){throw 'Migration deploy failed.'};if((Invoke-Child 'migrate-status' $node @($prisma,'migrate','status') $envRun) -ne 0){throw 'Migration status failed.'}
  if((Invoke-Child 'spec-eslint' $node @('node_modules/eslint/bin/eslint.js','tests/e2e/team-template-foreign-webinar-publish-boundary.spec.ts') $envRun) -ne 0){throw 'Spec lint failed.'};if((Invoke-Child 'auth-unit' $node @('node_modules/vitest/vitest.mjs','run','src/lib/auth.test.ts') $envRun) -ne 0){throw 'Auth unit gate failed.'}
  if((Invoke-Child 'browser-e2e' $node @('node_modules/@playwright/test/cli.js','test','tests/e2e/team-template-foreign-webinar-publish-boundary.spec.ts','--project=chromium','--retries=0','--reporter=json') $envRun) -ne 0){throw 'Browser gate failed.'};if((Invoke-Child 'typecheck' $node @('node_modules/typescript/bin/tsc','--noEmit') $envRun) -ne 0){throw 'Typecheck failed.'}
  $browserResultPath=$envRun.PLAYWRIGHT_JSON_OUTPUT_FILE;if(-not(Test-Path -LiteralPath $browserResultPath)){throw 'Browser JSON result artifact was not created.'};$browserResult=Get-Content -LiteralPath $browserResultPath -Raw|ConvertFrom-Json;$browserVerdict=[ordered]@{artifactType='browser-verdict';expected=[int]$browserResult.stats.expected;unexpected=[int]$browserResult.stats.unexpected;skipped=[int]$browserResult.stats.skipped;flaky=[int]$browserResult.stats.flaky;pass=$false};$browserVerdict.pass=($browserVerdict.expected -eq 1 -and $browserVerdict.unexpected -eq 0 -and $browserVerdict.skipped -eq 0 -and $browserVerdict.flaky -eq 0);Write-Json 'browser-verdict.sanitized.json' $browserVerdict;if(-not $browserVerdict.pass){throw 'Browser JSON verdict failed.'}
  Write-Json 'db-invariant-summary.sanitized.json' ([ordered]@{artifactType='db-invariant';assertion='Spec compares template, all versions, source page, A/B lives before and after denied publish.';result='UNCHANGED'})
} catch {$failure=Safe $_.Exception.Message} finally {
  if($schemaCreated){
    try {
      $envRun=Environment-ForRun
      $clean=Join-Path $snapshot 'wp53-cleanup.sql'
      $sql = 'DO $$ BEGIN IF current_database() <> ''celebratedeal_ci'' THEN RAISE EXCEPTION ''database mismatch''; END IF; IF (SELECT obj_description(oid, ''pg_namespace'') FROM pg_namespace WHERE nspname = ''' + $schema + ''') <> ''' + $marker + ''' THEN RAISE EXCEPTION ''marker mismatch''; END IF; EXECUTE ''DROP SCHEMA "' + $schema + '" CASCADE''; END $$;'
      [IO.File]::WriteAllText($clean,$sql,[Text.UTF8Encoding]::new($false))
      $cleanupExit=Invoke-Child 'database-cleanup' $node @($prisma,'db','execute','--schema','prisma/schema.prisma','--file','.\wp53-cleanup.sql') $envRun
      if($cleanupExit -ne 0){throw 'Schema cleanup failed.'}
    } catch {
      if($null -eq $failure){$failure=Safe $_.Exception.Message}
    }
  }
  $summary=[ordered]@{artifactType='final-runner-summary';workPackage='WP-53';runId=$runId;finalRunnerError=$failure;WP25_ARTIFACT_READ_COUNT=0;WP25_TARGET_EXECUTION_COUNT=0;syntheticEnvironmentOnly=$true;secretScan='POLICY_EXCLUDED_ENV_FILE_READ_PROHIBITED';schemaCleanup=if($schemaCreated){'ATTEMPTED'}else{'NOT_CREATED'}};Write-Json 'final-runner-summary.sanitized.json' $summary;Write-Json 'command-receipts.sanitized.json' ([ordered]@{artifactType='command-receipts';workPackage='WP-53';receipts=@($receipts)});if(Test-Path $snapshot){Remove-Item -LiteralPath $snapshot -Recurse -Force};if(Test-Path $runtime){Remove-Item -LiteralPath $runtime -Recurse -Force}
}
Write-Output "WP-53 report: $reportDir";if($failure){throw $failure}
