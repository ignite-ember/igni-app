# Silent install and uninstall of igni's Windows packages, the way a fleet
# tool (Intune, SCCM, a GPO startup script) runs them. Scenario ids are
# docs/ENTERPRISE_TEST_PLAN.md's.
#
#   windows-install.ps1 -Action install-msi   -Bundle <dir>   # ENT-021: msiexec /qn; prints the exe path
#   windows-install.ps1 -Action uninstall-msi -Bundle <dir>   # ENT-021 ENT-033: msiexec /x /qn; nothing left running
#   windows-install.ps1 -Action nsis          -Bundle <dir>   # ENT-021: setup.exe /S, then its uninstaller /S
param(
  [Parameter(Mandatory = $true)][string]$Action,
  [Parameter(Mandatory = $true)][string]$Bundle,
  [string]$Out = "desktop-e2e-out"
)
$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path $Out | Out-Null

function Get-Backends {
  Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like "*igni_core.backend*" }
}

function Find-Exe([string[]]$Roots) {
  foreach ($r in $Roots) {
    if (Test-Path $r) {
      $exe = Get-ChildItem -Path $r -Recurse -Filter "igni-app.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($exe) { return $exe.FullName }
    }
  }
  return $null
}

$programRoots = @("$env:ProgramFiles\igni", "${env:ProgramFiles(x86)}\igni", "$env:LOCALAPPDATA\igni", "$env:LOCALAPPDATA\Programs\igni")

switch ($Action) {
  "install-msi" {
    $msi = Get-ChildItem -Path (Join-Path $Bundle "msi") -Filter *.msi | Select-Object -First 1
    if (-not $msi) { throw "no .msi under $Bundle\msi" }
    $log = Join-Path $Out "msi-install.log"
    $p = Start-Process msiexec.exe -ArgumentList @("/i", "`"$($msi.FullName)`"", "/qn", "/norestart", "/l*v", "`"$log`"") -Wait -PassThru
    if ($p.ExitCode -ne 0) { throw "msiexec /i exited $($p.ExitCode); see $log" }
    $exe = Find-Exe $programRoots
    if (-not $exe) { throw "the MSI reported success but igni-app.exe is nowhere under $($programRoots -join ', ')" }
    $scheme = Get-Item "Registry::HKEY_CLASSES_ROOT\igni" -ErrorAction SilentlyContinue
    Write-Host "installed: $exe; igni:// registered: $([bool]$scheme)"
    "IGNI_APP=$exe" | Out-File -FilePath $env:GITHUB_ENV -Append -Encoding utf8
  }
  "uninstall-msi" {
    $msi = Get-ChildItem -Path (Join-Path $Bundle "msi") -Filter *.msi | Select-Object -First 1
    $log = Join-Path $Out "msi-uninstall.log"
    $p = Start-Process msiexec.exe -ArgumentList @("/x", "`"$($msi.FullName)`"", "/qn", "/norestart", "/l*v", "`"$log`"") -Wait -PassThru
    if ($p.ExitCode -ne 0) { throw "msiexec /x exited $($p.ExitCode); see $log" }
    $left = Find-Exe @("$env:ProgramFiles\igni", "${env:ProgramFiles(x86)}\igni")
    if ($left) { throw "uninstall left $left behind" }
    Start-Sleep -Seconds 5
    $running = @(Get-Backends)
    if ($running.Count -gt 0) { throw "a backend is still running after uninstall: $($running.CommandLine -join '; ')" }
    Write-Host "uninstalled: no igni-app.exe, no backend"
  }
  "nsis" {
    $setup = Get-ChildItem -Path (Join-Path $Bundle "nsis") -Filter *-setup.exe | Select-Object -First 1
    if (-not $setup) { throw "no NSIS setup under $Bundle\nsis" }
    $p = Start-Process $setup.FullName -ArgumentList "/S" -Wait -PassThru
    if ($p.ExitCode -ne 0) { throw "setup.exe /S exited $($p.ExitCode)" }
    $exe = Find-Exe $programRoots
    if (-not $exe) { throw "NSIS /S reported success but igni-app.exe is not installed" }
    Write-Host "NSIS installed: $exe"
    $dir = Split-Path $exe
    # The managed runtime's cache is %LOCALAPPDATA%\igni too; its "Reinstall
    # Backend (Clean)" must not take the app with it (runtime/managed.rs reset).
    Write-Host "::notice::NSIS install directory: $dir; managed runtime cache: $env:LOCALAPPDATA\igni"
    $uninstaller = Get-ChildItem -Path $dir -Filter "uninstall*.exe" | Select-Object -First 1
    if (-not $uninstaller) { throw "no uninstaller beside $exe" }
    $p = Start-Process $uninstaller.FullName -ArgumentList "/S" -Wait -PassThru
    if ($p.ExitCode -ne 0) { throw "the uninstaller /S exited $($p.ExitCode)" }
    # The NSIS uninstaller re-launches itself from %TEMP% and returns at once.
    $deadline = (Get-Date).AddSeconds(60)
    while ((Test-Path $exe) -and ((Get-Date) -lt $deadline)) { Start-Sleep -Seconds 2 }
    if (Test-Path $exe) { throw "the silent uninstall left $exe behind" }
    Write-Host "NSIS uninstalled silently"
  }
  default { throw "unknown action $Action" }
}
