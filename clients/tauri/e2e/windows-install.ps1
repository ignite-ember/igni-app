# Silent install and uninstall of igni's Windows packages, the way a fleet
# tool (Intune, SCCM, a GPO startup script) runs them. Scenario ids are
# docs/ENTERPRISE_TEST_PLAN.md's.
#
#   windows-install.ps1 -Action install-msi   -Bundle <dir>   # ENT-021: msiexec /qn; prints the exe path
#   windows-install.ps1 -Action uninstall-msi -Bundle <dir>   # ENT-021 ENT-033: msiexec /x /qn; nothing left running
#   windows-install.ps1 -Action nsis          -Bundle <dir>   # ENT-021: setup.exe /S, then its uninstaller /S
#   windows-install.ps1 -Action smoke         -Bundle <dir>   # PLAT-008 ENT-033: the installed app starts its backend
#                                                             # on IGNI_E2E_PYTHON and stops it when closed
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

# A console window the app's own children opened (python.exe, uv.exe): it
# would sit over the app for as long as the backend runs.
function Get-ConsoleWindows {
  Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -match '(?i)python|\\Scripts\\|\buv(\.exe)?\b' }
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

function Show-Installs([string[]]$Roots) {
  foreach ($r in $Roots) {
    if (Test-Path $r) {
      Get-ChildItem -Path $r -Recurse -Filter "igni-app.exe" -ErrorAction SilentlyContinue |
        ForEach-Object { Write-Host "  found: $($_.FullName) ($($_.LastWriteTime))" }
    }
  }
}

$programRoots = @("$env:ProgramFiles\igni", "${env:ProgramFiles(x86)}\igni", "$env:LOCALAPPDATA\igni", "$env:LOCALAPPDATA\Programs\igni")

switch ($Action) {
  "install-msi" {
    $msi = Get-ChildItem -Path (Join-Path $Bundle "msi") -Filter *.msi | Select-Object -First 1
    if (-not $msi) { throw "no .msi under $Bundle\msi" }
    $log = Join-Path $Out "msi-install.log"
    $p = Start-Process msiexec.exe -ArgumentList @("/i", "`"$($msi.FullName)`"", "/qn", "/norestart", "/l*v", "`"$log`"") -Wait -PassThru
    if ($p.ExitCode -ne 0) { throw "msiexec /i exited $($p.ExitCode); see $log" }
    Show-Installs $programRoots
    # A per-machine MSI installs under Program Files: prefer that one.
    $exe = Find-Exe @("$env:ProgramFiles\igni", "${env:ProgramFiles(x86)}\igni")
    if (-not $exe) { $exe = Find-Exe $programRoots }
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
  "smoke" {
    # Without WebDriver: does the installed app start, start its backend on
    # the provisioned interpreter, and take it down when it is closed?
    $project = Join-Path $env:RUNNER_TEMP "smoke-project"
    New-Item -ItemType Directory -Force -Path $project | Out-Null
    $env:IGNI_RUNTIME_PYTHON = $env:IGNI_E2E_PYTHON
    $app = Start-Process -FilePath $env:IGNI_APP -ArgumentList "`"$project`"" -PassThru
    $deadline = (Get-Date).AddSeconds(120)
    $backend = @()
    while ((Get-Date) -lt $deadline) {
      if ($app.HasExited) { throw "the app exited at start with code $($app.ExitCode)" }
      $backend = @(Get-Backends | Where-Object { $_.CommandLine -like "*smoke-project*" })
      if ($backend.Count -gt 0) { break }
      Start-Sleep -Seconds 2
    }
    Get-Process | Where-Object { $_.ProcessName -match "igni|msedgewebview2|python" } |
      Format-Table Id, ProcessName, StartTime -AutoSize | Out-String | Write-Host
    if ($backend.Count -eq 0) { throw "no igni_core.backend for the project within 120 s (the app is running: $(-not $app.HasExited))" }
    Write-Host "backend: $($backend[0].CommandLine)"
    $consoles = @(Get-ConsoleWindows)
    if ($consoles.Count -gt 0) { throw "the app's backend opened a console window: $(($consoles | ForEach-Object { "$($_.ProcessName): $($_.MainWindowTitle)" }) -join '; ')" }
    if ($backend[0].CommandLine -notlike "*$($env:IGNI_E2E_PYTHON)*") { throw "the backend is not on IGNI_RUNTIME_PYTHON" }
    # Close it the way a person does (WM_CLOSE), then make sure.
    $null = $app.CloseMainWindow()
    if (-not $app.WaitForExit(15000)) { Stop-Process -Id $app.Id -Force }
    $deadline = (Get-Date).AddSeconds(30)
    while ((Get-Date) -lt $deadline -and @(Get-Backends | Where-Object { $_.CommandLine -like "*smoke-project*" }).Count -gt 0) {
      Start-Sleep -Seconds 1
    }
    $left = @(Get-Backends | Where-Object { $_.CommandLine -like "*smoke-project*" })
    if ($left.Count -gt 0) { throw "the backend outlived the app by 30 s: $($left.CommandLine)" }
    Write-Host "the app started its backend and took it down when closed"
  }
  default { throw "unknown action $Action" }
}
