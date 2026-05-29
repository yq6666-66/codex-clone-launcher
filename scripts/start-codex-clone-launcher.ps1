$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$LogPath = Join-Path $ProjectRoot 'codex-clone-launcher.log'
$UpdateSettingsDir = Join-Path $env:LOCALAPPDATA 'codex-clone-launcher'
$UpdateSettingsPath = Join-Path $UpdateSettingsDir 'update_settings.json'
$CargoTomlPath = Join-Path $ProjectRoot 'src-tauri\Cargo.toml'
$DistIndex = Join-Path $ProjectRoot 'dist\index.html'
$StampPath = Join-Path $ProjectRoot 'target\release\.codex-clone-tauri-build.stamp'

Set-Location -LiteralPath $ProjectRoot

function Write-LauncherLog {
  param([string]$Message)
  $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
  Add-Content -LiteralPath $LogPath -Value "[$timestamp] $Message"
}

function Get-TauriPackageName {
  if (-not (Test-Path -LiteralPath $CargoTomlPath)) {
    return 'codex-clone-launcher'
  }

  $match = Select-String -LiteralPath $CargoTomlPath -Pattern '^\s*name\s*=\s*"([^"]+)"' | Select-Object -First 1
  if ($match -and $match.Matches.Count -gt 0) {
    return $match.Matches[0].Groups[1].Value
  }

  return 'codex-clone-launcher'
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

function Stop-ManagedProcesses {
  param([string[]]$ExecutablePaths)

  $knownPaths = $ExecutablePaths | ForEach-Object { $_.ToLowerInvariant() }
  foreach ($processName in @('codex-clone-launcher.exe', 'cockpit-tools.exe')) {
    Get-CimInstance Win32_Process -Filter "Name = '$processName'" |
      Where-Object {
        $_.ExecutablePath -and ($knownPaths -contains $_.ExecutablePath.ToLowerInvariant())
      } |
      ForEach-Object {
        Write-LauncherLog "Stopping old $processName pid=$($_.ProcessId)"
        Stop-Process -Id $_.ProcessId -Force
      }
  }
}

$startupMutex = New-Object System.Threading.Mutex($false, 'Global\CodexCloneLauncherStartup')
$hasStartupLock = $false

try {
  New-Item -ItemType Directory -Path (Split-Path -Parent $LogPath) -Force | Out-Null
  Remove-Item -LiteralPath $LogPath -Force -ErrorAction SilentlyContinue

  $hasStartupLock = $startupMutex.WaitOne(0)
  if (-not $hasStartupLock) {
    Write-LauncherLog 'Another launcher startup is already running; exiting this duplicate request.'
    return
  }

  $packageName = Get-TauriPackageName
  $appExe = Join-Path $ProjectRoot "target\release\$packageName.exe"
  $debugExe = Join-Path $ProjectRoot "target\debug\$packageName.exe"
  $knownExeCandidates = @(
    $appExe,
    $debugExe,
    (Join-Path $ProjectRoot 'target\release\codex-clone-launcher.exe'),
    (Join-Path $ProjectRoot 'target\debug\codex-clone-launcher.exe'),
    (Join-Path $ProjectRoot 'target\release\cockpit-tools.exe'),
    (Join-Path $ProjectRoot 'target\debug\cockpit-tools.exe')
  ) | Select-Object -Unique

  Stop-ManagedProcesses -ExecutablePaths $knownExeCandidates

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

  if (-not (Test-Path -LiteralPath $appExe)) {
    if (-not (Test-Path -LiteralPath $DistIndex)) {
      Write-LauncherLog 'dist is missing; running npm run build'
      $buildExitCode = Invoke-LoggedNpm @('run', 'build')
      if ($buildExitCode -ne 0) {
        throw "npm run build failed with exit code $buildExitCode"
      }
    }

    Write-LauncherLog "Release executable is missing; running npm run tauri -- build --no-bundle for $packageName"
    $tauriExitCode = Invoke-LoggedNpm @('run', 'tauri', '--', 'build', '--no-bundle')
    if ($tauriExitCode -ne 0) {
      throw "Tauri build failed with exit code $tauriExitCode"
    }

    if (-not (Test-Path -LiteralPath $appExe)) {
      throw "Desktop executable was not produced: $appExe"
    }

    New-Item -ItemType Directory -Path (Split-Path -Parent $StampPath) -Force | Out-Null
    [System.IO.File]::WriteAllText($StampPath, (Get-Date).ToUniversalTime().ToString('o'), [System.Text.UTF8Encoding]::new($false))
  }

  Write-LauncherLog "Starting $appExe"
  Start-Process -FilePath $appExe -WorkingDirectory $ProjectRoot
} catch {
  Write-LauncherLog ("Launcher failed: " + $_.Exception.Message)
  throw
} finally {
  if ($hasStartupLock) {
    $startupMutex.ReleaseMutex() | Out-Null
  }
  $startupMutex.Dispose()
}
