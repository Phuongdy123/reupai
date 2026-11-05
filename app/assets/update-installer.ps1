param(
    [Parameter(Mandatory=$true)][string]$Installer,
    [Parameter(Mandatory=$true)][string]$InstallDir,
    [Parameter(Mandatory=$true)][string]$ExpectedHash,
    [Parameter(Mandatory=$true)][string]$TargetVersion,
    [Parameter(Mandatory=$true)][string]$ResultPath
)
$ErrorActionPreference = 'Stop'
try {
    if ((Get-FileHash -LiteralPath $Installer -Algorithm SHA256).Hash -ine $ExpectedHash) {
        throw 'Bộ cài không khớp mã kiểm tra.'
    }
    $setupLog = Join-Path (Split-Path -Parent $ResultPath) 'install.log'
    $setup = Start-Process -FilePath $Installer -ArgumentList @(
        '/VERYSILENT', '/SP-', '/SUPPRESSMSGBOXES', '/NORESTART',
        ('/DIR="' + $InstallDir + '"'), ('/LOG="' + $setupLog + '"')
    ) -WindowStyle Hidden -Wait -PassThru
    if ($setup.ExitCode -notin @(0,3010)) { throw "Bộ cài dừng với mã $($setup.ExitCode). Xem install.log để kiểm tra." }
    $engine = Join-Path $InstallDir 'ReupAI.exe'
    if (-not (Test-Path -LiteralPath $engine -PathType Leaf)) { throw 'Không tìm thấy ReupAI sau cập nhật.' }
    if ([version](Get-Item -LiteralPath $engine).VersionInfo.ProductVersion -lt [version]$TargetVersion) {
        throw 'Phiên bản sau cập nhật chưa đúng.'
    }
    @{ status='completed'; version=$TargetVersion } | ConvertTo-Json | Set-Content -LiteralPath $ResultPath -Encoding UTF8
    Start-Process -FilePath $engine -ArgumentList '--background' -WindowStyle Hidden
} catch {
    @{ status='failed'; message=$_.Exception.Message } | ConvertTo-Json | Set-Content -LiteralPath $ResultPath -Encoding UTF8
    exit 1
}
