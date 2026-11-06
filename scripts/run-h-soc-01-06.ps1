# Run from any folder using PowerShell 7+ or Windows PowerShell 5.1.
# Requires Node dependencies installed and Java 21 available for Firebase emulators.
# Executes the complete existing Firestore integration suite plus H-SOC-01/02/03/04/06.
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$resultsDir = Join-Path $projectRoot 'docs\testing\H-SOC'
New-Item -ItemType Directory -Path $resultsDir -Force | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$logFile = Join-Path $resultsDir "firestore-soc-tasks-1-3-$stamp.txt"
$summaryFile = Join-Path $resultsDir "firestore-soc-tasks-1-3-$stamp-summary.txt"

Push-Location $projectRoot
try {
    $sha = 'unavailable (no Git checkout)'
    if (Test-Path (Join-Path $projectRoot '.git')) {
        $detectedSha = (& git rev-parse --verify HEAD 2>$null)
        if ($LASTEXITCODE -eq 0 -and $detectedSha) { $sha = $detectedSha }
    }
    $start = (Get-Date).ToString('o')
    @(
        'Interview Buddy | Firestore SOC 2 Tasks 1-3',
        "Started (local): $start",
        "Git revision: $sha",
        'Firebase project: demo-interview-buddy-tests',
        'Emulators: auth (127.0.0.1:9099), firestore (127.0.0.1:8089)',
        'Test command: npm --prefix server run test:emulator',
        'Expected coverage: H-SOC-01, H-SOC-02, H-SOC-03, H-SOC-04, H-SOC-06',
        'NOTE: PERMISSION_DENIED diagnostics are expected for denied client requests.',
        '--- Actual emulator test output ---'
    ) | Set-Content -Path $logFile

    # Tee-Object retains the full output for Jira attachments. Do not assume
    # tests passed unless the native command exits successfully.
    # In Windows PowerShell 5.1, native stderr can appear as a nonterminating
    # NativeCommandError even when negative security tests correctly pass.
    $priorErrorAction = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & npx --yes firebase-tools@14.12.0 emulators:exec `
            --only auth,firestore `
            --project demo-interview-buddy-tests `
            --non-interactive `
            'npm --prefix server run test:emulator' `
            2>&1 | Tee-Object -FilePath $logFile -Append
        $testExitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $priorErrorAction
    }
    $end = (Get-Date).ToString('o')
    $result = if ($testExitCode -eq 0) { 'PASS (command succeeded; inspect test counts)' } else { 'FAIL (command exited nonzero)' }
    @(
        'Interview Buddy | Firestore SOC 2 Tasks 1-3 execution summary',
        "Start: $start",
        "Finish: $end",
        "Git revision: $sha",
        "Exit code: $testExitCode",
        "Outcome: $result",
        'Evidence: complete test counts and individual case outcomes are in the accompanying log.',
        'Scope: emulator results only; NOT proof of deployed Firestore rules or API authorization.',
        "Log file: $logFile"
    ) | Set-Content -Path $summaryFile
    Write-Host "Full test log: $logFile"
    Write-Host "Jira summary: $summaryFile"
    if ($testExitCode -ne 0) { exit $testExitCode }
} finally {
    Pop-Location
}
