param(
  [string]$ShortcutPath,
  [string]$ShortcutName = 'Codex Clone Launcher.lnk'
)

$ErrorActionPreference = 'Stop'

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$LauncherScript = Join-Path $ProjectRoot 'scripts\start-codex-clone-launcher.ps1'
$IconPath = Join-Path $ProjectRoot 'src-tauri\icons\icon.ico'

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

$powerShell = (Get-Command 'powershell.exe' -ErrorAction Stop).Source
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
