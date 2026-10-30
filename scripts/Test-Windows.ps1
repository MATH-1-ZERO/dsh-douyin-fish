[CmdletBinding()]
param([string]$DshPath)
. (Join-Path $PSScriptRoot 'Windows-Common.ps1')
$installation = Find-DshInstallation -DshPath $DshPath
if (-not (Test-Path -LiteralPath $installation.Node -PathType Leaf)) { throw 'Bundled Node.js was not found. Use Node.js 24 and run npm test instead.' }
& $installation.Node (Join-Path $PSScriptRoot 'test.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Tests failed.' }
