param(
    [string]$BundlePath,
    [string]$OutputDirectory,
    [switch]$Preview,
    [string]$IdentityName,
    [string]$Publisher,
    [string]$PublisherDisplayName,
    # Must match the product name reserved in Partner Center, not the EXE description.
    [string]$DisplayName = "ReupAI",
    [string]$PackageVersion,
    [string]$StoreProductId,
    [string]$MakeAppxPath,
    [switch]$BootstrapSdk,
    [switch]$Overwrite
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$ProjectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$Python = Join-Path $ProjectRoot "venv\Scripts\python.exe"
$SdkPackageVersion = "10.0.26100.9457"
$SdkPackageSha256 = "4c2e0d85f3490e7f7c065c35b4c47fe913b1bc9627e9711ae349b2cdc7edc791"
$ToolsRoot = Join-Path $ProjectRoot "build\msix-tools"
$SdkRoot = Join-Path $ToolsRoot "sdk-$SdkPackageVersion"

function Resolve-InputPath([string]$Value, [string]$Fallback) {
    if ([string]::IsNullOrWhiteSpace($Value)) { $Value = $Fallback }
    return [IO.Path]::GetFullPath($Value)
}

function Find-MakeAppx {
    if ($MakeAppxPath) {
        $explicitPath = [IO.Path]::GetFullPath($MakeAppxPath)
        if (-not (Test-Path -LiteralPath $explicitPath -PathType Leaf)) { throw "MakeAppx not found: $explicitPath" }
        return $explicitPath
    }
    $command = Get-Command makeappx.exe -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    $sdkBins = @(
        (Join-Path ${env:ProgramFiles(x86)} "Windows Kits\10\bin"),
        (Join-Path $SdkRoot "bin")
    )
    foreach ($sdkBin in $sdkBins) {
        if (-not (Test-Path -LiteralPath $sdkBin -PathType Container)) { continue }
        $tool = Get-ChildItem -LiteralPath $sdkBin -Filter makeappx.exe -File -Recurse |
            Where-Object { $_.Directory.Name -eq "x64" } |
            Sort-Object FullName -Descending | Select-Object -First 1
        if ($tool) { return $tool.FullName }
    }
    return $null
}

function Install-LocalSdk {
    # Local, pinned Microsoft NuGet package; this never installs a machine SDK.
    New-Item -ItemType Directory -Path $ToolsRoot -Force | Out-Null
    $archive = Join-Path $ToolsRoot "microsoft.windows.sdk.buildtools.$SdkPackageVersion.nupkg"
    if (-not (Test-Path -LiteralPath $archive -PathType Leaf)) {
        $oldProgress = $ProgressPreference
        try {
            $ProgressPreference = "SilentlyContinue"
            Invoke-WebRequest -Uri "https://api.nuget.org/v3-flatcontainer/microsoft.windows.sdk.buildtools/$SdkPackageVersion/microsoft.windows.sdk.buildtools.$SdkPackageVersion.nupkg" -OutFile $archive -TimeoutSec 120
        } finally { $ProgressPreference = $oldProgress }
    }
    if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $SdkPackageSha256) {
        throw "Windows SDK NuGet package checksum mismatch. No package was built."
    }
    if (-not (Test-Path -LiteralPath $SdkRoot -PathType Container)) {
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        [IO.Compression.ZipFile]::ExtractToDirectory($archive, $SdkRoot)
    }
    $tool = Find-MakeAppx
    if (-not $tool) { throw "Verified SDK package does not contain x64 MakeAppx.exe." }
    $signature = Get-AuthenticodeSignature -FilePath $tool
    if ($signature.Status -ne "Valid" -or $signature.SignerCertificate.Subject -notmatch '(^|, )O=Microsoft Corporation(,|$)') {
        throw "Downloaded MakeAppx.exe does not have a valid Microsoft signature."
    }
    return $tool
}

$BundlePath = Resolve-InputPath $BundlePath (Join-Path $ProjectRoot "dist\ReupAI")
$OutputDirectory = Resolve-InputPath $OutputDirectory (Join-Path $ProjectRoot "release\msix")
$ExePath = Join-Path $BundlePath "ReupAI.exe"
if (-not (Test-Path -LiteralPath $ExePath -PathType Leaf)) { throw "Build the frozen Engine first: missing $ExePath" }
if (-not (Test-Path -LiteralPath $Python -PathType Leaf)) { throw "Missing build Python: $Python" }
$fileVersion = (Get-Item -LiteralPath $ExePath).VersionInfo.ProductVersion
if ($fileVersion -notmatch '^\d+\.\d+\.\d+$') { throw "ReupAI.exe must have a three-part ProductVersion." }
if (-not $PackageVersion) { $PackageVersion = "$fileVersion.0" }
$versionPrefix = ($PackageVersion -split '\.')[0..2] -join '.'
if ($PackageVersion -notmatch '^\d+\.\d+\.\d+\.0$' -or $versionPrefix -ne $fileVersion) {
    throw "PackageVersion must match ReupAI.exe ProductVersion and use Store revision 0 (expected $fileVersion.0)."
}
foreach ($part in $PackageVersion.Split('.')) {
    if ([int]$part -gt 65535) { throw "Each package version component must be between 0 and 65535." }
}

if ($Preview) {
    if ($IdentityName -or $Publisher -or $PublisherDisplayName -or $StoreProductId) {
        throw "Preview uses a fixed development identity. Omit Partner Center identity arguments or remove -Preview."
    }
    $IdentityName = "ReupAI.LocalEngine.Preview"
    $Publisher = "CN=ReupAI Local Preview"
    $PublisherDisplayName = "ReupAI Preview"
    $DisplayName = "ReupAI Local Engine Preview"
} else {
    foreach ($field in @("IdentityName", "Publisher", "PublisherDisplayName")) {
        if ([string]::IsNullOrWhiteSpace((Get-Variable -Name $field -ValueOnly))) {
            throw "Store build requires -$field copied exactly from Partner Center > Product identity. Use -Preview only for local packaging validation."
        }
    }
}
if ($IdentityName -notmatch '^[A-Za-z0-9][A-Za-z0-9.-]{2,49}$') { throw "Invalid MSIX Identity Name (3-50 ASCII letters, digits, periods or hyphens)." }
if ($Publisher -notmatch '^CN=\S' -or $Publisher -match '[\r\n]') { throw "Publisher must be the exact one-line Partner Center X.500 value beginning CN=." }
if ($StoreProductId -and $StoreProductId -notmatch '^[A-Za-z0-9]{12}$') { throw "StoreProductId must be the 12-character Store product ID, for example the value in its Store URL." }

$makeAppx = if ($BootstrapSdk) { Install-LocalSdk } else { Find-MakeAppx }
if (-not $makeAppx) { throw "Install the Windows SDK, pass -MakeAppxPath, or use -BootstrapSdk to fetch the pinned Microsoft build tools locally." }

$requiredFiles = @("_internal\bin\ffmpeg.exe", "_internal\bin\ffprobe.exe", "_internal\app\assets\google_oauth_client.json")
foreach ($relativePath in $requiredFiles) {
    if (-not (Test-Path -LiteralPath (Join-Path $BundlePath $relativePath) -PathType Leaf)) { throw "Frozen Engine is incomplete: $relativePath" }
}
if ($OutputDirectory.StartsWith($BundlePath.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase) -or $OutputDirectory -eq $BundlePath) {
    throw "OutputDirectory must be outside the frozen Engine folder."
}
$bundleEntries = @(Get-ChildItem -LiteralPath $BundlePath -Recurse -Force)
if ($bundleEntries | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint } | Select-Object -First 1) {
    throw "Reparse points are not supported in the frozen Engine. Use a normal build output folder."
}
$bundleFiles = @($bundleEntries | Where-Object { -not $_.PSIsContainer } | Sort-Object FullName)
foreach ($file in $bundleFiles) {
    $relativePath = $file.FullName.Substring($BundlePath.Length).TrimStart('\')
    if ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Reparse points are not supported in the package: $relativePath" }
    $isPublicCertifiBundle = $relativePath -match '(^|\\)certifi\\cacert\.pem$'
    if (($file.Name -match '^\.env($|\.)|^local_token$|\.(pfx|p12|pem|key)$') -and -not $isPublicCertifiBundle) {
        throw "Potential private build material found in frozen Engine: $relativePath"
    }
}
$mode = if ($Preview) { "preview" } else { "store" }
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$packagePath = Join-Path $OutputDirectory "ReupAI-LocalEngine-$PackageVersion-x64-$mode-unsigned.msix"
if ((Test-Path -LiteralPath $packagePath) -and -not $Overwrite) { throw "Output already exists. Use a new version/output folder or explicitly pass -Overwrite: $packagePath" }
$stageRoot = Join-Path $ProjectRoot ("build\msix\" + $mode + "-" + $PackageVersion + "-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $stageRoot -Force | Out-Null
foreach ($file in $bundleFiles) {
    $relativePath = $file.FullName.Substring($BundlePath.Length).TrimStart('\')
    $target = Join-Path $stageRoot $relativePath
    New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($target)) -Force | Out-Null
    Copy-Item -LiteralPath $file.FullName -Destination $target
}
& $Python (Join-Path $ProjectRoot "packaging\msix\generate_assets.py") --source (Join-Path $ProjectRoot "web\public\images\reupai-logo.png") --output (Join-Path $stageRoot "Assets")
if ($LASTEXITCODE -ne 0) { throw "Failed to generate ReupAI MSIX assets." }
$template = Get-Content -LiteralPath (Join-Path $ProjectRoot "packaging\msix\AppxManifest.xml.in") -Raw
foreach ($entry in @{
    IDENTITY_NAME = $IdentityName; PUBLISHER = $Publisher; VERSION = $PackageVersion;
    DISPLAY_NAME = $DisplayName; PUBLISHER_DISPLAY_NAME = $PublisherDisplayName
}.GetEnumerator()) {
    $template = $template.Replace("{{" + $entry.Key + "}}", [Security.SecurityElement]::Escape($entry.Value))
}
if ($template -match '\{\{[^}]+\}\}') { throw "Unresolved manifest placeholders remain." }
[IO.File]::WriteAllText((Join-Path $stageRoot "AppxManifest.xml"), $template, [Text.UTF8Encoding]::new($false))
$distribution = [ordered]@{format=1;distribution="msix";updateProvider="microsoft-store";packageIdentityName=$IdentityName;preview=[bool]$Preview}
if ($StoreProductId) { $distribution.storeProductId = $StoreProductId.ToUpperInvariant() }
[IO.File]::WriteAllText((Join-Path $stageRoot "reupai-distribution.json"), ($distribution | ConvertTo-Json), [Text.UTF8Encoding]::new($false))

Write-Host "Packing $mode MSIX with semantic validation enabled: $PackageVersion"
# /nv is intentionally forbidden: Microsoft manifest and package checks must run.
$packLog = "$packagePath.pack.log"
& $makeAppx pack /h SHA256 /d $stageRoot /p $packagePath /o *> $packLog
if ($LASTEXITCODE -ne 0) {
    Get-Content -LiteralPath $packLog -Tail 35 | Write-Host
    throw "MakeAppx validation/pack failed with exit code $LASTEXITCODE. Log: $packLog. Staging: $stageRoot"
}
$sha256 = (Get-FileHash -LiteralPath $packagePath -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText("$packagePath.sha256", "$sha256  $([IO.Path]::GetFileName($packagePath))`n", [Text.ASCIIEncoding]::new())
$report = [ordered]@{
    format=1;packagePath=$packagePath;sha256=$sha256;size=(Get-Item -LiteralPath $packagePath).Length;
    signed=$false;semanticValidation=$true;preview=[bool]$Preview;version=$PackageVersion;identityName=$IdentityName;
    publisher=$Publisher;publisherDisplayName=$PublisherDisplayName;displayName=$DisplayName;
    sourceExeSha256=(Get-FileHash -LiteralPath $ExePath -Algorithm SHA256).Hash.ToLowerInvariant();
    fileCount=$bundleFiles.Count;makeAppx=$makeAppx;stagePath=$stageRoot;
    generatedAt=[DateTime]::UtcNow.ToString("o")
}
[IO.File]::WriteAllText("$packagePath.build.json", ($report | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
Write-Host "Package: $packagePath"
Write-Host "SHA256: $sha256"
if ($Preview) { Write-Warning "Preview identity only. This unsigned package is NOT ready for Store submission or customer installation." }
else { Write-Host "Unsigned Store submission artifact. Microsoft signs it after certification; it is not a directly installable public download." }
