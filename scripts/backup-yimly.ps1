$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

$config = @{}
if (Test-Path '.env') {
  foreach ($line in Get-Content '.env') {
    if ($line -match '^\s*([^#=\s]+)\s*=(.*)$') {
      $config[$matches[1]] = $matches[2].Trim().Trim('"').Trim("'")
    }
  }
}

$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$backupDir = Join-Path $root 'backups'
$stage = Join-Path $env:TEMP "yimly_backup_$stamp"
$archive = Join-Path $backupDir "yimly_backup_$stamp.tar.gz"
New-Item -ItemType Directory -Force -Path $backupDir, $stage | Out-Null

$copied = 0
foreach ($item in @(
  @{ Key = 'DATA_PATH'; Name = 'data'; Default = '.\data' },
  @{ Key = 'MEDIA_PATH'; Name = 'media'; Default = '.\media' }
)) {
  $source = $config[$item.Key]
  if ([string]::IsNullOrWhiteSpace($source)) { $source = $item.Default }
  if (-not [System.IO.Path]::IsPathRooted($source)) { $source = Join-Path $root $source }
  if (Test-Path -LiteralPath $source -PathType Container) {
    $destination = Join-Path $stage $item.Name
    New-Item -ItemType Directory -Force -Path $destination | Out-Null
    Get-ChildItem -Force -LiteralPath $source | Copy-Item -Destination $destination -Recurse -Force
    $copied++
  } elseif (Test-Path -LiteralPath $source) {
    throw "Configured path is not a directory: $source"
  }
}

if ($copied -eq 0) { throw 'Neither the configured data directory nor media directory exists; refusing to create an empty backup.' }
if (-not (Get-Command tar -ErrorAction SilentlyContinue)) { throw 'tar is unavailable; install a supported Windows tar utility before updating.' }
& tar -czf $archive -C $stage .
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $archive)) { throw 'Backup archive creation failed.' }
Remove-Item -LiteralPath $stage -Recurse -Force
Write-Output "Backup created: $archive"
