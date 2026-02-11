param(
  [ValidateSet("founder-daily", "report", "queue")]
  [string]$Mode = "founder-daily",
  [string]$TaskName = "PuppetMasterTelegramFounderDaily",
  [string]$Time = "09:00",
  [string]$WorkingDir = "C:\projects\PuppetMaster\PuppetMaster",
  [string]$FounderExo = "C:\projects\CryptoCOO\founderExo.md",
  [string]$RunsRoot = "C:\projects\PuppetMaster\PuppetMaster\runs",
  [string]$RunDir = "",
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

if (!(Test-Path -LiteralPath $WorkingDir)) {
  throw "WorkingDir not found: $WorkingDir"
}

if ($Mode -eq "founder-daily" -and !(Test-Path -LiteralPath $FounderExo)) {
  throw "FounderExo not found: $FounderExo"
}

$modeArgs = switch ($Mode) {
  "founder-daily" { "--mode founder-daily --founder-exo `"$FounderExo`"" }
  "report" {
    if ($RunDir) { "--mode report --run-dir `"$RunDir`"" } else { "--mode report --runs-root `"$RunsRoot`"" }
  }
  "queue" {
    if ($RunDir) { "--mode queue --run-dir `"$RunDir`"" } else { "--mode queue --runs-root `"$RunsRoot`"" }
  }
}

$npmCmd = "cd /d `"$WorkingDir`" && npm run agent:telegram -- $modeArgs"
$taskRun = "cmd.exe /c `"$npmCmd`""

if ($DryRun) {
  Write-Output "[DRY RUN] Scheduler command:"
  Write-Output ("schtasks /Create /SC DAILY /TN `"$TaskName`" /TR `"$taskRun`" /ST $Time /F")
  exit 0
}

& schtasks /Create /SC DAILY /TN $TaskName /TR $taskRun /ST $Time /F | Out-Null
$code = $LASTEXITCODE
if ($code -ne 0) { throw "Failed to create task. Exit code: $code" }

Write-Output "Created scheduled task: $TaskName"
Write-Output "Runs daily at: $Time"
Write-Output "Mode: $Mode"
