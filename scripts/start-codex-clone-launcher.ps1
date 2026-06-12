$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$LogPath = Join-Path $ProjectRoot 'codex-clone-launcher.log'
$LocalAppData = [Environment]::GetFolderPath('LocalApplicationData')
if ([string]::IsNullOrWhiteSpace($LocalAppData)) {
  $LocalAppData = $env:LOCALAPPDATA
}
if ([string]::IsNullOrWhiteSpace($LocalAppData)) {
  throw 'LOCALAPPDATA is not available; cannot resolve app settings directory.'
}
$UpdateSettingsDir = Join-Path $LocalAppData 'codex-clone-launcher'
$UpdateSettingsPath = Join-Path $UpdateSettingsDir 'update_settings.json'
$PackageJsonPath = Join-Path $ProjectRoot 'package.json'
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

function Get-PackageVersion {
  if (-not (Test-Path -LiteralPath $PackageJsonPath)) {
    return '0.0.0'
  }

  try {
    $packageJson = Get-Content -LiteralPath $PackageJsonPath -Raw | ConvertFrom-Json
    if ($packageJson.version) {
      return [string]$packageJson.version
    }
  } catch {
    Write-LauncherLog ("Failed to read package.json version: " + $_.Exception.Message)
  }

  return '0.0.0'
}

function Invoke-LoggedNpm {
  param([string[]]$Arguments)

  $npmCommand = Get-Command 'npm.cmd' -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $npmCommand) {
    $npmCommand = Get-Command 'npm' -ErrorAction SilentlyContinue | Select-Object -First 1
  }
  if (-not $npmCommand) {
    throw 'npm was not found on PATH. Install Node.js LTS, then run npm ci before starting the launcher.'
  }

  Write-LauncherLog ("Running npm " + ($Arguments -join ' '))
  $stdoutPath = [System.IO.Path]::GetTempFileName()
  $stderrPath = [System.IO.Path]::GetTempFileName()

  try {
    $quotedNpm = '"' + $npmCommand.Source + '"'
    $quotedArguments = ($Arguments | ForEach-Object {
        if ($_ -match '[\s"]') {
          '"' + ($_ -replace '"', '\"') + '"'
        } else {
          $_
        }
      }) -join ' '
    $commandLine = "$quotedNpm $quotedArguments 1> `"$stdoutPath`" 2> `"$stderrPath`""
    & $env:ComSpec /d /s /c $commandLine
    $exitCode = $LASTEXITCODE

    if (Test-Path -LiteralPath $stdoutPath) {
      Get-Content -LiteralPath $stdoutPath -Raw -ErrorAction SilentlyContinue | Add-Content -LiteralPath $LogPath
    }
    if (Test-Path -LiteralPath $stderrPath) {
      Get-Content -LiteralPath $stderrPath -Raw -ErrorAction SilentlyContinue | Add-Content -LiteralPath $LogPath
    }

    return $exitCode
  } finally {
    Remove-Item -LiteralPath $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue
  }
}

function Ensure-NodeDependencies {
  $tauriCli = Join-Path $ProjectRoot 'node_modules\.bin\tauri.cmd'
  if (Test-Path -LiteralPath $tauriCli) {
    return
  }

  $installArgs = @('install')
  if (Test-Path -LiteralPath (Join-Path $ProjectRoot 'package-lock.json')) {
    $installArgs = @('ci')
  }

  Write-LauncherLog ("node_modules is missing or incomplete; running npm " + ($installArgs -join ' '))
  $installExitCode = Invoke-LoggedNpm $installArgs
  if ($installExitCode -ne 0) {
    throw "npm $($installArgs -join ' ') failed with exit code $installExitCode"
  }
}

function Get-NewestSourceWriteTime {
  $roots = @(
    (Join-Path $ProjectRoot 'src'),
    (Join-Path $ProjectRoot 'src-tauri\src'),
    (Join-Path $ProjectRoot 'public')
  ) | Where-Object { Test-Path -LiteralPath $_ }

  $files = @()
  $watchedExtensions = @('.cjs', '.css', '.html', '.ico', '.js', '.json', '.mjs', '.png', '.rs', '.svg', '.ts', '.tsx')
  foreach ($root in $roots) {
    $files += Get-ChildItem -LiteralPath $root -Recurse -File -ErrorAction SilentlyContinue |
      Where-Object { $_.Extension -in $watchedExtensions }
  }

  foreach ($path in @(
      (Join-Path $ProjectRoot 'src-tauri\tauri.conf.json'),
      (Join-Path $ProjectRoot 'src-tauri\Cargo.toml'),
      (Join-Path $ProjectRoot 'Cargo.lock'),
      (Join-Path $ProjectRoot 'package.json'),
      (Join-Path $ProjectRoot 'package-lock.json'),
      (Join-Path $ProjectRoot 'tsconfig.json'),
      (Join-Path $ProjectRoot 'tsconfig.node.json'),
      (Join-Path $ProjectRoot 'vite.config.ts')
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
  param([string]$ExecutablePath)

  if (-not (Test-Path -LiteralPath $ExecutablePath)) {
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

function Stop-ManagedProcesses {
  param([string[]]$ExecutablePaths)

  $knownPaths = $ExecutablePaths | ForEach-Object { $_.ToLowerInvariant() }
  foreach ($processName in @('codex-clone-launcher.exe')) {
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

  $hasStartupLock = $startupMutex.WaitOne(0)
  if (-not $hasStartupLock) {
    Write-LauncherLog 'Another launcher startup is already running; exiting this duplicate request.'
    return
  }

  Remove-Item -LiteralPath $LogPath -Force -ErrorAction SilentlyContinue
  Write-LauncherLog 'Launcher startup lock acquired.'

  $packageName = Get-TauriPackageName
  $packageVersion = Get-PackageVersion
  $appExe = Join-Path $ProjectRoot "target\release\$packageName.exe"
  $debugExe = Join-Path $ProjectRoot "target\debug\$packageName.exe"
  $knownExeCandidates = @(
    $appExe,
    $debugExe,
    (Join-Path $ProjectRoot 'target\release\codex-clone-launcher.exe'),
    (Join-Path $ProjectRoot 'target\debug\codex-clone-launcher.exe')
  ) | Select-Object -Unique

  Stop-ManagedProcesses -ExecutablePaths $knownExeCandidates

  New-Item -ItemType Directory -Path $UpdateSettingsDir -Force | Out-Null
  $settings = @{
    auto_check = $false
    last_check_time = 0
    check_interval_hours = 24
    auto_install = $false
    last_run_version = $packageVersion
    remind_on_update = $false
    skipped_version = ''
  } | ConvertTo-Json -Depth 3
  [System.IO.File]::WriteAllText($UpdateSettingsPath, $settings, [System.Text.UTF8Encoding]::new($false))

  $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = "$machinePath;$userPath"

  if (Test-NeedsTauriBuild -ExecutablePath $appExe) {
    Ensure-NodeDependencies
    Write-LauncherLog "Release executable is missing or stale; running npm run tauri -- build --no-bundle for $packageName"
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
