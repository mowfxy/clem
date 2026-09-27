# Signs a COPY of the Store MSIX with a self-signed test certificate so it can be installed on this PC.
# The file you upload to Partner Center stays unsigned; the Store signs it with Microsoft's certificate.
#
#   powershell -ExecutionPolicy Bypass -File scripts/store-test-sign.ps1
#
# The certificate's subject must equal the manifest's Publisher, so it is read from electron-builder.store.cjs.
# The .pfx and .cer land in .store-cert/ (git-ignored). Trusting the .cer is a separate, admin step; see docs/microsoft-store.md.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

$config = node -e "const c=require('./electron-builder.store.cjs');console.log(JSON.stringify({publisher:c.appx.publisher,out:c.directories.output,name:c.win.artifactName}))" | ConvertFrom-Json
if ($config.publisher -notmatch '^CN=') { throw "Set identity.publisher in electron-builder.store.cjs to the CN=... value from Partner Center first." }
$package = Join-Path $config.out $config.name
if (-not (Test-Path $package)) { throw "No package at $package. Run: npm run desktop:store" }

$certDir = Join-Path $root '.store-cert'
New-Item -ItemType Directory -Force $certDir | Out-Null
$pfx = Join-Path $certDir 'mowr-store-test.pfx'
$cer = Join-Path $certDir 'mowr-store-test.cer'
$password = 'mowr-local-test'

if (-not (Test-Path $pfx)) {
  # Lives in your personal certificate store (Current User > Personal); delete it there to remove it.
  $cert = New-SelfSignedCertificate -Type Custom -Subject $config.publisher -KeyUsage DigitalSignature `
    -FriendlyName 'Mowr Store local test signing' -CertStoreLocation 'Cert:\CurrentUser\My' `
    -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3', '2.5.29.19={text}') -NotAfter (Get-Date).AddYears(2)
  Export-PfxCertificate -Cert $cert -FilePath $pfx -Password (ConvertTo-SecureString $password -Force -AsPlainText) | Out-Null
  Export-Certificate -Cert $cert -FilePath $cer | Out-Null
  Write-Host "Made a test certificate for $($config.publisher)"
}

$signtool = @(
  Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\signtool.exe" -ErrorAction SilentlyContinue
  Get-ChildItem "$env:LOCALAPPDATA\electron-builder\Cache\winCodeSign" -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue | Where-Object { $_.FullName -match 'x64' }
) | Select-Object -First 1
if (-not $signtool) { throw 'signtool.exe not found. Install the Windows SDK, or run npm run desktop:store once so electron-builder downloads it.' }

$signed = [IO.Path]::ChangeExtension($package, '.test-signed.msix')
Copy-Item $package $signed -Force
& $signtool.FullName sign /fd SHA256 /a /f $pfx /p $password $signed
if ($LASTEXITCODE -ne 0) { throw 'signtool failed.' }
Write-Host "`nTest-signed copy: $signed"
Write-Host "Upload the unsigned one: $package"
