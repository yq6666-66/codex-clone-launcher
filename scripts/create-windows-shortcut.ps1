param(
  [string]$ShortcutPath,
  [string]$ShortcutName = ''
)

$ErrorActionPreference = 'Stop'

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$LauncherScript = Join-Path $ProjectRoot 'scripts\start-codex-clone-launcher.ps1'
$IconPath = Join-Path $ProjectRoot 'src-tauri\icons\icon.ico'

if ([string]::IsNullOrWhiteSpace($ShortcutName)) {
  $ShortcutName = 'Codex ' + [string][char]0x5206 + [string][char]0x8eab + [string][char]0x542f + [string][char]0x52a8 + [string][char]0x5668 + '.lnk'
}

if (-not (Test-Path -LiteralPath $LauncherScript)) {
  throw "Launcher script was not found: $LauncherScript"
}

if ([string]::IsNullOrWhiteSpace($ShortcutPath)) {
  $desktopPath = [Environment]::GetFolderPath('DesktopDirectory')
  if ([string]::IsNullOrWhiteSpace($desktopPath)) {
    throw 'DesktopDirectory is not available. Pass -ShortcutPath explicitly.'
  }
  $ShortcutPath = Join-Path $desktopPath $ShortcutName
}

$shortcutDir = Split-Path -Parent $ShortcutPath
if (-not [string]::IsNullOrWhiteSpace($shortcutDir)) {
  New-Item -ItemType Directory -Path $shortcutDir -Force | Out-Null
}

$systemRoot = $env:SystemRoot
if ([string]::IsNullOrWhiteSpace($systemRoot)) {
  $systemRoot = $env:windir
}
if ([string]::IsNullOrWhiteSpace($systemRoot)) {
  throw 'SystemRoot is not available; cannot resolve system PowerShell path.'
}
$powerShell = Join-Path $systemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
if (-not (Test-Path -LiteralPath $powerShell)) {
  throw "System PowerShell was not found: $powerShell"
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($ShortcutPath)
$shortcut.TargetPath = $powerShell
$shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$LauncherScript`""
$shortcut.WorkingDirectory = $ProjectRoot
$shortcut.WindowStyle = 7

if (Test-Path -LiteralPath $IconPath) {
  $shortcut.IconLocation = "$IconPath,0"
}

$shortcut.Save()
Write-Host "Created shortcut: $ShortcutPath"
