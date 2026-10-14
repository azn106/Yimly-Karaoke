param (
    [string]$Archive = '',
    [switch]$Force
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

$config = @{}
if (Test-Path -LiteralPath '.env') {
    foreach ($line in Get-Content -LiteralPath '.env') {
        if ($line -match '^\s*([^#=\s]+)\s*=(.*)$') {
            $config[$matches[1]] = $matches[2].Trim().Trim('"').Trim("'")
        }
    }
}

$backupDir = Join-Path $root 'backups'
if ([string]::IsNullOrWhiteSpace($Archive)) {
    if (-not (Test-Path -LiteralPath $backupDir -PathType Container)) {
        throw "No backups directory found at: $backupDir"
    }
    $latest = Get-ChildItem -LiteralPath $backupDir -Filter 'yimly_backup_*.tar.gz' |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1

    if (-not $latest) {
        throw "No backup archive found in: $backupDir"
    }
    $Archive = $latest.FullName
} elseif (-not [System.IO.Path]::IsPathRooted($Archive)) {
    $Archive = Join-Path $root $Archive
}

if (-not (Test-Path -LiteralPath $Archive -PathType Leaf)) {
    throw "Backup archive not found: $Archive"
}

if (-not (Get-Command tar -ErrorAction SilentlyContinue)) {
    throw 'tar is unavailable; install a supported Windows tar utility before restoring.'
}

# Verify archive integrity
& tar -tzf $Archive > $null
if ($LASTEXITCODE -ne 0) {
    throw "Backup archive integrity check failed: $Archive"
}

$entries = & tar -tzf $Archive
if ($LASTEXITCODE -ne 0) {
    throw 'Could not read the archive listing for verification.'
}

$hasDb = $entries | Where-Object { $_ -match '(^|/|\\)yimly\.db$' }
if (-not $hasDb) {
    throw "Backup verification failed: yimly.db was not found in archive: $Archive"
}

Write-Output "Restoring from verified archive: $Archive"

$targetData = $config['DATA_PATH']
if ([string]::IsNullOrWhiteSpace($targetData)) { $targetData = '.\data' }
if (-not [System.IO.Path]::IsPathRooted($targetData)) { $targetData = Join-Path $root $targetData }

$targetMedia = $config['MEDIA_PATH']
if ([string]::IsNullOrWhiteSpace($targetMedia)) { $targetMedia = '.\media' }
if (-not [System.IO.Path]::IsPathRooted($targetMedia)) { $targetMedia = Join-Path $root $targetMedia }

# Extract safely into a temporary staging folder first to avoid destroying live data if tar fails
$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$tempStage = Join-Path $env:TEMP "yimly_restore_$stamp"
New-Item -ItemType Directory -Force -Path $tempStage | Out-Null

try {
    & tar -xzf $Archive -C $tempStage
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to extract archive into staging location: $tempStage"
    }

    $stagedData = Join-Path $tempStage 'data'
    $stagedMedia = Join-Path $tempStage 'media'

    if (-not (Test-Path -LiteralPath $stagedData -PathType Container)) {
        throw "Archive does not contain a 'data' container folder."
    }

    # Backup the current data folder to a temporary safety copy before replacement
    if (Test-Path -LiteralPath $targetData -PathType Container) {
        $preRestoreCopy = "${targetData}_prerestore_$stamp"
        Copy-Item -LiteralPath $targetData -Destination $preRestoreCopy -Recurse -Force
        Write-Output "Created safety pre-restore backup at: $preRestoreCopy"
    }

    New-Item -ItemType Directory -Force -Path $targetData | Out-Null
    Get-ChildItem -Force -LiteralPath $stagedData | Copy-Item -Destination $targetData -Recurse -Force

    if (Test-Path -LiteralPath $stagedMedia -PathType Container) {
        New-Item -ItemType Directory -Force -Path $targetMedia | Out-Null
        Get-ChildItem -Force -LiteralPath $stagedMedia | Copy-Item -Destination $targetMedia -Recurse -Force
    }

    Write-Output "Restoration completed successfully from $Archive"
    Write-Output "Restored DATA_PATH: $targetData"
    Write-Output "Restored MEDIA_PATH: $targetMedia"
}
finally {
    if (Test-Path -LiteralPath $tempStage) {
        Remove-Item -LiteralPath $tempStage -Recurse -Force
    }
}
