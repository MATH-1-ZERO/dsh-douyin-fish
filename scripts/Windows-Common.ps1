Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Find-DshInstallation {
    param([string]$DshPath)
    $candidates = New-Object 'System.Collections.Generic.List[string]'
    if ($DshPath) { $candidates.Add($DshPath) }
    if ($env:DSH_INSTALL_DIR) { $candidates.Add($env:DSH_INSTALL_DIR) }
    foreach ($root in @($env:LOCALAPPDATA, $env:ProgramFiles, ${env:ProgramFiles(x86)})) {
        if ($root) {
            $candidates.Add((Join-Path $root 'DeepSeek Harness'))
            $candidates.Add((Join-Path $root 'Programs\DeepSeek Harness'))
        }
    }
    foreach ($registry in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*')) {
        foreach ($item in @(Get-ItemProperty -Path $registry -ErrorAction SilentlyContinue)) {
            if ($item.PSObject.Properties['DisplayName'] -and $item.DisplayName -like '*DeepSeek*Harness*') {
                if ($item.PSObject.Properties['InstallLocation'] -and $item.InstallLocation) { $candidates.Add($item.InstallLocation) }
                if ($item.PSObject.Properties['DisplayIcon'] -and $item.DisplayIcon) {
                    $icon = ($item.DisplayIcon -replace ',\d+$', '').Trim('"')
                    $candidates.Add((Split-Path -Parent $icon))
                }
            }
        }
    }
    foreach ($candidate in $candidates) {
        $folder = $candidate
        if ([IO.Path]::GetExtension($candidate) -eq '.exe') { $folder = Split-Path -Parent $candidate }
        $exe = Join-Path $folder 'DeepSeek Harness.exe'
        $archive = Join-Path $folder 'resources\app.asar'
        if ((Test-Path -LiteralPath $exe -PathType Leaf) -and (Test-Path -LiteralPath $archive -PathType Leaf)) {
            $folder = (Resolve-Path -LiteralPath $folder).Path
            return [pscustomobject]@{
                Root = $folder
                Exe = Join-Path $folder 'DeepSeek Harness.exe'
                Cli = Join-Path $folder 'resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\cli.js'
                Node = Join-Path $folder 'resources\runtime\primary-runtime\dependencies\node\bin\node.exe'
            }
        }
    }
    throw 'DeepSeek Harness was not found. Re-run with -DshPath "X:\your-install-folder".'
}

function Invoke-DshCli {
    param($Installation, [string[]]$Arguments, [string]$DshHome)
    $oldElectron = $env:ELECTRON_RUN_AS_NODE
    $oldDshHome = $env:DSH_HOME
    try {
        $env:ELECTRON_RUN_AS_NODE = '1'
        if ($DshHome) { $env:DSH_HOME = $DshHome }
        & $Installation.Exe --expose-internals $Installation.Cli @Arguments | Out-Host
        if ($LASTEXITCODE -ne 0) { throw "Official DSH CLI failed (exit $LASTEXITCODE). See its output above." }
    } finally {
        if ($null -eq $oldElectron) { Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue } else { $env:ELECTRON_RUN_AS_NODE = $oldElectron }
        if ($null -eq $oldDshHome) { Remove-Item Env:DSH_HOME -ErrorAction SilentlyContinue } else { $env:DSH_HOME = $oldDshHome }
    }
}

function Get-FishHome {
    param([string]$DshHome)
    if ($DshHome) { return [IO.Path]::GetFullPath($DshHome) }
    if ($env:DSH_HOME) { return [IO.Path]::GetFullPath($env:DSH_HOME) }
    return Join-Path ([Environment]::GetFolderPath('UserProfile')) '.dsh'
}
