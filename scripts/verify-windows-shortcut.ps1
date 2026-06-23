$ErrorActionPreference = 'Stop'

if ([System.Environment]::OSVersion.Platform -ne [System.PlatformID]::Win32NT) {
  Write-Host 'Windows shortcut verification skipped: not running on Windows.'
  exit 0
}

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$ShortcutDir = Join-Path ([System.IO.Path]::GetTempPath()) ('codex-clone-shortcut-verify-' + [System.Guid]::NewGuid().ToString('N'))
$ShortcutName = 'Codex Clone Launcher.lnk'
$ShortcutPath = Join-Path $ShortcutDir $ShortcutName
$CreateScript = Join-Path $ProjectRoot 'scripts\create-windows-shortcut.ps1'
$LauncherScript = Join-Path $ProjectRoot 'scripts\start-codex-clone-launcher.ps1'
$IconPath = Join-Path $ProjectRoot 'src-tauri\icons\icon.ico'
$systemRoot = $env:SystemRoot
if ([string]::IsNullOrWhiteSpace($systemRoot)) {
  $systemRoot = $env:windir
}
if ([string]::IsNullOrWhiteSpace($systemRoot)) {
  throw 'SystemRoot is not available; cannot resolve system PowerShell path.'
}
$ExpectedPowerShell = Join-Path $systemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
if (-not (Test-Path -LiteralPath $ExpectedPowerShell)) {
  throw "System PowerShell was not found: $ExpectedPowerShell"
}

function Assert-Equal {
  param(
    [string]$Name,
    [string]$Actual,
    [string]$Expected
  )

  if ($Actual -ne $Expected) {
    throw "$Name mismatch. Expected: $Expected Actual: $Actual"
  }
}

try {
  New-Item -ItemType Directory -Path $ShortcutDir -Force | Out-Null
  & $CreateScript -ShortcutPath $ShortcutPath

  if (-not (Test-Path -LiteralPath $ShortcutPath)) {
    throw "Shortcut was not created: $ShortcutPath"
  }

  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($ShortcutPath)

  Assert-Equal -Name 'TargetPath' -Actual $shortcut.TargetPath -Expected $ExpectedPowerShell
  Assert-Equal -Name 'WorkingDirectory' -Actual $shortcut.WorkingDirectory -Expected $ProjectRoot

  $expectedArguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$LauncherScript`""
  Assert-Equal -Name 'Arguments' -Actual $shortcut.Arguments -Expected $expectedArguments

  if ((Test-Path -LiteralPath $IconPath) -and -not $shortcut.IconLocation.StartsWith($IconPath, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "IconLocation mismatch. Expected prefix: $IconPath Actual: $($shortcut.IconLocation)"
  }

  Write-Host "Windows shortcut verification OK: $ShortcutPath"
} finally {
  Remove-Item -LiteralPath $ShortcutDir -Recurse -Force -ErrorAction SilentlyContinue
}
