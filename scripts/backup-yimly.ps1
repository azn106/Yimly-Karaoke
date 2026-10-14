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

$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$backupDir = Join-Path $root 'backups'
$stage = Join-Path $env:TEMP "yimly_backup_$stamp"
$archive = Join-Path $backupDir "yimly_backup_$stamp.tar.gz"

New-Item -ItemType Directory -Force -Path $backupDir, $stage | Out-Null

try {
    foreach ($item in @(
        @{ Key = 'DATA_PATH'; Name = 'data'; Default = '.\data' },
        @{ Key = 'MEDIA_PATH'; Name = 'media'; Default = '.\media' }
    )) {
        $source = $config[$item.Key]
        if ([string]::IsNullOrWhiteSpace($source)) {
            $source = $item.Default
        }
        if (-not [System.IO.Path]::IsPathRooted($source)) {
            $source = Join-Path $root $source
        }
        if (-not (Test-Path -LiteralPath $source -PathType Container)) {
            throw "Required backup directory is missing or not a directory: $source"
        }

        $destination = Join-Path $stage $item.Name
        New-Item -ItemType Directory -Force -Path $destination | Out-Null

        if ($item.Name -eq 'data') {
            Get-ChildItem -Force -LiteralPath $source |
                Where-Object { $_.Name -ne 'models' } |
                Copy-Item -Destination $destination -Recurse -Force

            $sourceModels = Join-Path $source 'models'
            if (Test-Path -LiteralPath $sourceModels -PathType Container) {
                $destinationModels = Join-Path $destination 'models'
                New-Item -ItemType Directory -Force -Path $destinationModels | Out-Null

                Get-ChildItem -Force -LiteralPath $sourceModels |
                    Where-Object { $_.Name -ne 'hub' } |
                    Copy-Item -Destination $destinationModels -Recurse -Force
            }
        }
        else {
            Get-ChildItem -Force -LiteralPath $source |
                Copy-Item -Destination $destination -Recurse -Force
        }
    }

    if (-not (Get-Command tar -ErrorAction SilentlyContinue)) {
        throw 'tar is unavailable; install a supported Windows tar utility before updating.'
    }

    & tar -czf $archive -C $stage .
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $archive)) {
        throw "Backup archive creation failed. tar exit code: $LASTEXITCODE"
    }

    & tar -tzf $archive > $null
    if ($LASTEXITCODE -ne 0) {
        throw 'Backup archive verification failed.'
    }

    $requiredEntries = @(
        './data/yimly.db',
        './media/'
    )
    $entries = & tar -tzf $archive
    if ($LASTEXITCODE -ne 0) {
        throw 'Could not read the archive listing for verification.'
    }
    foreach ($entry in $requiredEntries) {
        if (-not ($entries | Where-Object { $_ -eq $entry -or $_.StartsWith($entry) })) {
            throw "Backup verification failed: expected archive entry missing: $entry"
        }
    }

    if ($entries | Where-Object { $_ -match '^./data/models/hub(/|$)' }) {
        throw 'Backup verification failed: model hub cache was unexpectedly included.'
    }

    Write-Output "Backup created and archive listing verified: $archive"
    Write-Output "Archive size: $((Get-Item -LiteralPath $archive).Length) bytes"
}
finally {
    if (Test-Path -LiteralPath $stage) {
        Remove-Item -LiteralPath $stage -Recurse -Force
    }
}
