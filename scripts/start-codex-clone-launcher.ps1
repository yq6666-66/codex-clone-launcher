$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$LogPath = Join-Path $ProjectRoot 'codex-clone-launcher.log'
$UpdateSettingsDir = Join-Path $env:LOCALAPPDATA 'codex-clone-launcher'
$UpdateSettingsPath = Join-Path $UpdateSettingsDir 'update_settings.json'
$AppExe = Join-Path $ProjectRoot 'target\release\codex-clone-launcher.exe'
$DebugExe = Join-Path $ProjectRoot 'target\debug\codex-clone-launcher.exe'
$StampPath = Join-Path $ProjectRoot 'target\release\.codex-clone-tauri-build.stamp'
$DistIndex = Join-Path $ProjectRoot 'dist\index.html'

Set-Location -LiteralPath $ProjectRoot
Remove-Item -LiteralPath $LogPath -Force -ErrorAction SilentlyContinue

function Write-LauncherLog {
  param([string]$Message)
  $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
  Add-Content -LiteralPath $LogPath -Value "[$timestamp] $Message"
}

function Invoke-LoggedNpm {
  param([string[]]$Arguments)

  $stdoutPath = [System.IO.Path]::GetTempFileName()
  $stderrPath = [System.IO.Path]::GetTempFileName()

  try {
    $process = Start-Process `
      -FilePath 'npm.cmd' `
      -ArgumentList $Arguments `
      -WorkingDirectory $ProjectRoot `
      -Wait `
      -PassThru `
      -NoNewWindow `
      -RedirectStandardOutput $stdoutPath `
      -RedirectStandardError $stderrPath

    if (Test-Path -LiteralPath $stdoutPath) {
      Get-Content -LiteralPath $stdoutPath -Raw -ErrorAction SilentlyContinue | Add-Content -LiteralPath $LogPath
    }
    if (Test-Path -LiteralPath $stderrPath) {
      Get-Content -LiteralPath $stderrPath -Raw -ErrorAction SilentlyContinue | Add-Content -LiteralPath $LogPath
    }

    return $process.ExitCode
  } finally {
    Remove-Item -LiteralPath $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue
  }
}

function Get-NewestSourceWriteTime {
  $roots = @(
    (Join-Path $ProjectRoot 'src'),
    (Join-Path $ProjectRoot 'src-tauri\src')
  ) | Where-Object { Test-Path -LiteralPath $_ }

  $files = @()
  foreach ($root in $roots) {
    $files += Get-ChildItem -LiteralPath $root -Recurse -File -Include *.ts,*.tsx,*.css,*.rs
  }
  foreach ($path in @(
      (Join-Path $ProjectRoot 'src-tauri\tauri.conf.json'),
      (Join-Path $ProjectRoot 'src-tauri\Cargo.toml'),
      (Join-Path $ProjectRoot 'package.json')
    )) {
    if (Test-Path -LiteralPath $path) {
      $files += Get-Item -LiteralPath $path
    }
  }

  if (-not $files) {
    return [DateTime]::MinValue
  }

  return ($files | ForEach-Object { $_.LastWriteTimeUtc } | Sort-Object -Descending | Select-Object -First 1)
}

function Test-NeedsTauriBuild {
  if (-not (Test-Path -LiteralPath $AppExe)) {
    return $true
  }
  if (-not (Test-Path -LiteralPath $StampPath)) {
    return $true
  }
  if (-not (Test-Path -LiteralPath $DistIndex)) {
    return $true
  }

  $stampTime = (Get-Item -LiteralPath $StampPath).LastWriteTimeUtc
  $distTime = (Get-Item -LiteralPath $DistIndex).LastWriteTimeUtc
  $sourceTime = Get-NewestSourceWriteTime

  return ($stampTime -lt $distTime) -or ($stampTime -lt $sourceTime)
}

try {
  $appExeLower = $AppExe.ToLowerInvariant()
  $debugExeLower = $DebugExe.ToLowerInvariant()
  Get-CimInstance Win32_Process -Filter "Name = 'codex-clone-launcher.exe'" |
    Where-Object {
      $_.ExecutablePath -and (
        $_.ExecutablePath.ToLowerInvariant() -eq $appExeLower -or
        $_.ExecutablePath.ToLowerInvariant() -eq $debugExeLower
      )
    } |
    ForEach-Object {
      Write-LauncherLog "Stopping old codex-clone-launcher.exe pid=$($_.ProcessId)"
      Stop-Process -Id $_.ProcessId -Force
    }

  New-Item -ItemType Directory -Path $UpdateSettingsDir -Force | Out-Null
  $settings = @{
    auto_check = $false
    last_check_time = 0
    check_interval_hours = 24
    auto_install = $false
    last_run_version = '0.24.7'
    remind_on_update = $false
    skipped_version = ''
  } | ConvertTo-Json -Depth 3
  [System.IO.File]::WriteAllText($UpdateSettingsPath, $settings, [System.Text.UTF8Encoding]::new($false))

  $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = "$machinePath;$userPath"

  if (-not (Test-Path -LiteralPath $DistIndex)) {
    Write-LauncherLog 'dist is missing; running npm run build'
    $exitCode = Invoke-LoggedNpm @('run', 'build')
    if ($exitCode -ne 0) {
      throw "npm run build failed with exit code $exitCode"
    }
  }

  if (Test-NeedsTauriBuild) {
    Write-LauncherLog 'Tauri release executable is missing or stale; running npm run tauri -- build --no-bundle'
    $exitCode = Invoke-LoggedNpm @('run', 'tauri', '--', 'build', '--no-bundle')
    if ($exitCode -ne 0) {
      throw "Tauri build failed with exit code $exitCode"
    }
    if (-not (Test-Path -LiteralPath $AppExe)) {
      throw "Tauri build finished but executable was not produced: $AppExe"
    }
    New-Item -ItemType Directory -Path (Split-Path -Parent $StampPath) -Force | Out-Null
    [System.IO.File]::WriteAllText($StampPath, (Get-Date).ToUniversalTime().ToString('o'), [System.Text.UTF8Encoding]::new($false))
  }

  if (-not (Test-Path -LiteralPath $AppExe)) {
    throw "未找到桌面程序：$AppExe"
  }

  Write-LauncherLog "Starting $AppExe"
  Start-Process -FilePath $AppExe -WorkingDirectory $ProjectRoot
} catch {
  Write-LauncherLog ("Launcher failed: " + $_.Exception.Message)
  throw
}
