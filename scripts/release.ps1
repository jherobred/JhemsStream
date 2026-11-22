# Builds the signed NSIS installer + latest.json for the in-app updater.
# Usage:  .\scripts\release.ps1                         (build only)
#         .\scripts\release.ps1 -Publish -Notes "What changed"   (build + GitHub release)
param([switch]$Publish, [string]$Notes = "")
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
# Prepend cargo: a stray quote in this machine's PATH hides later entries from cmd-spawned tools.
$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"

$ver = (Get-Content src-tauri\tauri.conf.json -Raw | ConvertFrom-Json).version
$keyFile = "$env:USERPROFILE\.tauri\jhemsstream.key"
if (-not (Test-Path $keyFile)) { throw "Updater signing key missing: $keyFile" }
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content $keyFile -Raw
# The key was generated with the literal password "" (two double quotes).
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = '""'

npx tauri build
if ($LASTEXITCODE) { throw "tauri build failed" }

$nsis = "src-tauri\target\release\bundle\nsis"
$exe = Get-ChildItem $nsis -Filter "*_${ver}_x64-setup.exe" | Select-Object -First 1
if (-not $exe) { throw "Setup exe for $ver not found in $nsis" }
$out = "src-tauri\target\release\upload"
New-Item -ItemType Directory -Force $out | Out-Null
Get-ChildItem $out | Remove-Item -Force
$name = "JhemsStream_${ver}_x64-setup.exe"          # no spaces, so the GitHub asset name matches the URL
Copy-Item $exe.FullName "$out\$name"
Copy-Item "$($exe.FullName).sig" "$out\$name.sig"

$manifest = [ordered]@{
  version   = $ver
  notes     = $Notes
  pub_date  = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  platforms = @{ "windows-x86_64" = @{
    signature = (Get-Content "$out\$name.sig" -Raw).Trim()
    url       = "https://github.com/jherobred/JhemsStream/releases/download/v$ver/$name"
  } }
} | ConvertTo-Json -Depth 5
# no byte-order mark: the updater's JSON parser rejects one
[IO.File]::WriteAllText("$out\latest.json", $manifest, (New-Object Text.UTF8Encoding $false))

Get-ChildItem $out | Select-Object Name, Length | Format-Table -AutoSize

if ($Publish) {
  $notesFile = "$out\notes.md"
  Set-Content $notesFile ($(if ($Notes) { $Notes } else { "JhemsStream v$ver" })) -Encoding utf8
  gh release create "v$ver" "$out\$name" "$out\$name.sig" "$out\latest.json" -R jherobred/JhemsStream --title "JhemsStream v$ver" --notes-file $notesFile
  if ($LASTEXITCODE) { throw "gh release create failed" }
}
