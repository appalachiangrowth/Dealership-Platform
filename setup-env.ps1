# Creates backend\.env, dealer-portal\.env.local, admin\.env.local and frontend\.env.local for this folder.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$utf8 = New-Object System.Text.UTF8Encoding($false)

function Pick($dir, $names) {
  foreach ($n in $names) { $p = Join-Path $root "$dir\$n"; if (Test-Path $p) { return $p } }
  throw "No template found in $dir"
}

Write-Host ""
Write-Host "Dealer Platform - settings setup" -ForegroundColor Cyan
$sec = Read-Host "Enter your PostgreSQL password (user 'postgres')" -AsSecureString
$plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
if ([string]::IsNullOrEmpty($plain)) { throw "Password cannot be empty." }
$enc = [uri]::EscapeDataString($plain)

# backend\.env
$tpl = Pick 'backend' @('rename-to-dot-env.txt', '.env.example')
$text = [IO.File]::ReadAllText($tpl)
$text = $text.Replace('[password]', $enc).Replace('postgres:postgres@', "postgres:$enc@")
[IO.File]::WriteAllText((Join-Path $root 'backend\.env'), $text, $utf8)
Write-Host "  created backend\.env" -ForegroundColor Green

# dealer portal + platform admin + website
foreach ($app in 'dealer-portal', 'admin', 'frontend') {
  $tpl = Pick $app @('rename-to-dot-env-local.txt', '.env.example')
  [IO.File]::WriteAllText((Join-Path $root "$app\.env.local"), [IO.File]::ReadAllText($tpl), $utf8)
  Write-Host "  created $app\.env.local" -ForegroundColor Green
}

# quick database connection test
Write-Host ""
Write-Host "Testing the database connection..." -ForegroundColor Cyan
Push-Location (Join-Path $root 'backend')
try {
  'SELECT 1;' | npx prisma db execute --stdin
  if ($LASTEXITCODE -eq 0) { Write-Host "Database connection OK." -ForegroundColor Green }
  else { Write-Host "Could not connect - check the password and that PostgreSQL is running." -ForegroundColor Red }
} finally { Pop-Location }
