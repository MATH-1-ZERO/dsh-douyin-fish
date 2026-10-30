[CmdletBinding()]
param([string]$DshPath, [ValidatePattern('^[A-Za-z0-9_-]+$')][string]$Profile = 'desktop', [string]$DshHome, [switch]$CheckOnly)
. (Join-Path $PSScriptRoot 'Windows-Common.ps1')
$installation = Find-DshInstallation -DshPath $DshPath
$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$manifest = Get-Content -LiteralPath (Join-Path $repo 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($manifest.name -ne '@local/dsh-douyin-fish' -or $manifest.version -ne '0.8.0-dev.19') { throw 'Unexpected plugin package.' }
$dataHome = Get-FishHome -DshHome $DshHome
$profileDir = Join-Path (Join-Path $dataHome 'profiles') $Profile
Write-Host "Plugin: $($manifest.name) $($manifest.version)"
Write-Host "Source: $repo"
Write-Host "DSH: $($installation.Root)"
Write-Host "Profile: $profileDir"
Invoke-DshCli -Installation $installation -Arguments @('--version') -DshHome $dataHome
if ($CheckOnly) { Write-Host 'Check completed. No files were installed or changed.'; return }
if (-not (Test-Path -LiteralPath (Join-Path $profileDir 'package.json'))) { throw 'Open DeepSeek Harness once to initialize this profile, then exit it from the tray and retry.' }
if ($Profile -eq 'desktop' -and $dataHome -eq (Join-Path ([Environment]::GetFolderPath('UserProfile')) '.dsh')) {
    $running = @(Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue)
    if ($running.Count) { throw 'Exit DeepSeek Harness from its system tray before installing. This script will not terminate it.' }
}
$backup = Join-Path (Join-Path $dataHome 'fish-install-backups') ([DateTime]::Now.ToString('yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory -Path $backup | Out-Null
foreach ($name in @('package.json','pnpm-lock.yaml','pnpm-workspace.yaml','cordis.patch.yml','.npmrc')) {
    $source = Join-Path $profileDir $name
    if (Test-Path -LiteralPath $source -PathType Leaf) { Copy-Item -LiteralPath $source -Destination (Join-Path $backup $name) }
}
Write-Host "Profile backup: $backup"
# The official manager owns dependencies and bundle selection. No app.asar edits.
$spec = 'link:' + $repo.Replace('\','/')
Invoke-DshCli -Installation $installation -DshHome $dataHome -Arguments @('plugin','--profile',$Profile,'add',$spec,'--offline','--ignore-scripts')
$installed = Get-Content -LiteralPath (Join-Path $profileDir 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if (-not $installed.dependencies.PSObject.Properties['@local/dsh-douyin-fish'] -or $installed.dsh.profile.bundles -notcontains '@local/dsh-douyin-fish') { throw 'The manager did not select the plugin bundle. Keep the backup and review CLI output.' }
Write-Host 'Installed. Keep this repository folder in place (DSH links to it).'
Write-Host 'Start DSH, then Settings > Fish console. Follow README.md for first-time persona and owner setup.'
Write-Host 'Installation does not log into Douyin or start automatic replies.'
