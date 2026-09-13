# Full data backup of the Supabase project without pg_dump, Docker or npx:
# every public table as CSV (via PostgREST), auth users as JSON (admin API),
# and the storage object listing. Output goes to backups\<timestamp>\, which
# is git-ignored — the dump contains e-mails and personal data.
#
# Usage (PowerShell, from the repo root):
#   powershell -ExecutionPolicy Bypass -File scripts\backup-db.ps1
# Schema is not dumped: it lives in supabase\migrations\ already.
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

# Load .env.local (KEY=value lines; ignores comments and blanks)
Get-Content ".env.local" | ForEach-Object {
  $line = $_.Trim([char]0xFEFF).Trim()
  if ($line -and -not $line.StartsWith("#") -and $line.Contains("=")) {
    $k, $v = $line.Split("=", 2)
    Set-Item -Path "env:$($k.Trim())" -Value $v.Trim()
  }
}
if (-not $env:SUPABASE_URL) { throw "SUPABASE_URL missing in .env.local" }
if (-not $env:SUPABASE_SERVICE_ROLE_KEY) { throw "SUPABASE_SERVICE_ROLE_KEY missing in .env.local" }

$out = Join-Path "backups" (Get-Date -Format "yyyyMMdd-HHmmss")
New-Item -ItemType Directory -Force -Path $out | Out-Null

$headers = @{
  apikey        = $env:SUPABASE_SERVICE_ROLE_KEY
  Authorization = "Bearer $($env:SUPABASE_SERVICE_ROLE_KEY)"
  "User-Agent"  = "phum-backup"
}

$tables = @("profiles","user_roles","documents","reminders","expenses","incomes","chat_messages",
            "families","family_members","helper_profiles","jobs","job_offers","job_reviews",
            "benefit_profiles","user_benefits","benefits","platform_settings",
            "ai_settings","ai_events","aivora_links")

Write-Host "-> $out"
foreach ($t in $tables) {
  $csv = Invoke-RestMethod -Uri "$($env:SUPABASE_URL)/rest/v1/$t`?select=*&limit=100000" -Headers ($headers + @{ Accept = "text/csv" })
  $path = Join-Path $out "$t.csv"
  [System.IO.File]::WriteAllText((Resolve-Path $out).Path + "\$t.csv", [string]$csv, [System.Text.UTF8Encoding]::new($false))
  $rows = [Math]::Max(0, ((Get-Content $path | Measure-Object -Line).Lines - 1))
  Write-Host ("  {0,-18} {1,4} rows" -f $t, $rows)
}

$users = Invoke-RestMethod -Uri "$($env:SUPABASE_URL)/auth/v1/admin/users?per_page=1000" -Headers $headers
$users | ConvertTo-Json -Depth 10 | Set-Content -Path (Join-Path $out "auth_users.json") -Encoding utf8
Write-Host ("  {0,-18} {1,4} rows" -f "auth.users", @($users.users).Count)

# Storage: object listing only. Download the files from Dashboard -> Storage if you want copies.
$listHeaders = $headers + @{ "Content-Type" = "application/json" }
$top = Invoke-RestMethod -Method Post -Uri "$($env:SUPABASE_URL)/storage/v1/object/list/documents" -Headers $listHeaders -Body '{"prefix":"","limit":1000}'
$files = @()
foreach ($dir in $top) {
  $inner = Invoke-RestMethod -Method Post -Uri "$($env:SUPABASE_URL)/storage/v1/object/list/documents" -Headers $listHeaders -Body ('{"prefix":"' + $dir.name + '","limit":1000}')
  foreach ($f in $inner) { $files += "$($dir.name)/$($f.name)" }
}
$files | Set-Content -Path (Join-Path $out "storage_documents_files.txt") -Encoding utf8
Write-Host ("  {0,-18} {1,4} files" -f "storage", $files.Count)

Write-Host "done. verify with:  Get-ChildItem $out | Select-Object Name, Length"
