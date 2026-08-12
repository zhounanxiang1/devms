param(
  [string]$HostName = "localhost",
  [int]$Port = 3306,
  [string]$User = "dms_app",
  [string]$Database = "demand_mgmt_test",
  [string]$Input = "",
  [string]$MySql = "mysql",
  [switch]$AppendOnly
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

  throw "mysql not found. Pass -MySql or add mysql to PATH."
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

$repoRoot = Split-Path -Parent $PSScriptRoot
if (!$Input) {
  $Input = Join-Path $repoRoot "deploy\system_data.sql"
}
$ClearInput = Join-Path $repoRoot "deploy\clear_system_data.sql"

if (!(Test-Path $Input)) {
  throw "System data file not found: $Input"
}
if (!$AppendOnly -and !(Test-Path $ClearInput)) {
  throw "System data clear file not found: $ClearInput"
}

$mysqlExe = Resolve-Executable -CommandName $MySql -FallbackPath "D:\mysql\mysql-8.4.10-winx64\bin\mysql.exe"
$sourcePath = (Resolve-Path $Input).Path.Replace("\", "/")
$clearPath = if (Test-Path $ClearInput) { (Resolve-Path $ClearInput).Path.Replace("\", "/") } else { "" }

Ensure-Password

function Invoke-MySqlSource {
  param([string]$SqlPath)

  $mysqlArgs = @(
    "--host=$HostName",
    "--port=$Port",
    "--user=$User",
    "--default-character-set=utf8mb4",
    $Database,
    "--execute=source $SqlPath"
  )

  & $mysqlExe @mysqlArgs
  if ($LASTEXITCODE -ne 0) {
    throw "mysql import failed with exit code $LASTEXITCODE."
  }
}

try {
  if (!$AppendOnly) {
    Write-Host "Clearing existing system master data before import..."
    Invoke-MySqlSource -SqlPath $clearPath
  }
  Invoke-MySqlSource -SqlPath $sourcePath
  Write-Host "System data imported from $Input"
} finally {
  if ($createdPasswordEnv) {
    Remove-Item Env:\MYSQL_PWD -ErrorAction SilentlyContinue
  }
}
