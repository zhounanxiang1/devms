param(
  [string]$HostName = "localhost",
  [int]$Port = 3306,
  [string]$User = "dms_app",
  [string]$Database = "demand_mgmt",
  [string]$Output = "",
  [string]$MySqlDump = "mysqldump",
  [switch]$ExcludeCodeSequence
)

$ErrorActionPreference = "Stop"

function Resolve-Executable {
  param(
    [string]$CommandName,
    [string]$FallbackPath
  )

  if ($CommandName -and (Test-Path $CommandName)) {
    return (Resolve-Path $CommandName).Path
  }

  $command = Get-Command $CommandName -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  if ($FallbackPath -and (Test-Path $FallbackPath)) {
    return $FallbackPath
  }

  throw "mysqldump not found. Pass -MySqlDump or add mysqldump to PATH."
}

$createdPasswordEnv = $false

function Ensure-Password {
  if ($env:MYSQL_PWD) {
    return
  }

  $securePassword = Read-Host "MySQL password" -AsSecureString
  $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
  )
  $env:MYSQL_PWD = $plainPassword
  $script:createdPasswordEnv = $true
}

function Normalize-TableNames {
  param([string]$SqlPath)

  $tableMap = @{
    "organization" = "Organization"
    "position" = "Position"
    "person" = "Person"
    "personposition" = "PersonPosition"
    "account" = "Account"
    "dictionary" = "Dictionary"
    "requirementpriority" = "RequirementPriority"
    "defectpriority" = "DefectPriority"
    "boardruleconfig" = "BoardRuleConfig"
    "codesequence" = "CodeSequence"
  }

  $sql = Get-Content -Raw -Encoding UTF8 $SqlPath
  $quote = [char]96
  foreach ($entry in $tableMap.GetEnumerator()) {
    $from = "$quote$($entry.Key)$quote"
    $to = "$quote$($entry.Value)$quote"
    $sql = $sql.Replace($from, $to)
  }
  Set-Content -Encoding UTF8 -NoNewline -Path $SqlPath -Value $sql
}

$repoRoot = Split-Path -Parent $PSScriptRoot
if (!$Output) {
  $Output = Join-Path $repoRoot "deploy\system_data.sql"
}

$outputDir = Split-Path -Parent $Output
if (!(Test-Path $outputDir)) {
  New-Item -ItemType Directory -Path $outputDir | Out-Null
}

$dumpExe = Resolve-Executable -CommandName $MySqlDump -FallbackPath "D:\mysql\mysql-8.4.10-winx64\bin\mysqldump.exe"

$tables = @(
  "Organization",
  "Position",
  "Person",
  "PersonPosition",
  "Account",
  "Dictionary",
  "RequirementPriority",
  "DefectPriority",
  "BoardRuleConfig"
)

if (!$ExcludeCodeSequence) {
  $tables += "CodeSequence"
}

Ensure-Password

$dumpArgs = @(
  "--host=$HostName",
  "--port=$Port",
  "--user=$User",
  "--default-character-set=utf8mb4",
  "--no-create-info",
  "--skip-triggers",
  "--no-tablespaces",
  "--single-transaction",
  "--skip-lock-tables",
  $Database
)
$dumpArgs += $tables
$dumpArgs += "--result-file=$Output"

try {
  & $dumpExe @dumpArgs
  if ($LASTEXITCODE -ne 0) {
    throw "mysqldump failed with exit code $LASTEXITCODE."
  }
  Normalize-TableNames -SqlPath $Output
  Write-Host "System data exported to $Output"
} finally {
  if ($createdPasswordEnv) {
    Remove-Item Env:\MYSQL_PWD -ErrorAction SilentlyContinue
  }
}
