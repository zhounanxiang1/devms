$ErrorActionPreference = "Stop"

$mysqlDump = "D:\mysql\mysql-8.4.10-winx64\bin\mysqldump.exe"
$output = Join-Path (Split-Path -Parent $PSScriptRoot) "deploy\system_data.sql"

if (!(Test-Path $mysqlDump)) {
  throw "mysqldump not found: $mysqlDump"
}

if (!$env:MYSQL_PWD) {
  $securePassword = Read-Host "MySQL password" -AsSecureString
  $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
  )
  $env:MYSQL_PWD = $plainPassword
}

& $mysqlDump `
  -h localhost `
  -P 3306 `
  -u dms_app `
  --default-character-set=utf8mb4 `
  --no-create-info `
  --skip-triggers `
  --no-tablespaces `
  --single-transaction `
  --skip-lock-tables `
  demand_mgmt `
  Organization Position Person PersonPosition Account Dictionary RequirementPriority DefectPriority BoardRuleConfig `
  --result-file=$output

Remove-Item Env:\MYSQL_PWD -ErrorAction SilentlyContinue

Write-Host "System data exported to $output"
