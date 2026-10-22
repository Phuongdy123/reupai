param(
    [switch]$SkipInstaller
)

$ErrorActionPreference = "Stop"
$ProjectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$Python = Join-Path $ProjectRoot "venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $Python)) {
    throw "Không tìm thấy môi trường Python: $Python"
}

$EngineSource = Get-Content -LiteralPath (Join-Path $ProjectRoot "app\local_engine.py") -Raw
$InstallerSource = Get-Content -LiteralPath (Join-Path $ProjectRoot "packaging\ReupAI.iss") -Raw
$VersionSource = Get-Content -LiteralPath (Join-Path $ProjectRoot "packaging\version_info.txt") -Raw
$EngineVersion = [regex]::Match($EngineSource, '(?m)^ENGINE_VERSION = "([0-9]+\.[0-9]+\.[0-9]+)"$').Groups[1].Value
$InstallerVersion = [regex]::Match($InstallerSource, '(?m)^#define MyAppVersion "([0-9]+\.[0-9]+\.[0-9]+)"$').Groups[1].Value
if (-not $EngineVersion -or $EngineVersion -ne $InstallerVersion) {
    throw "Phiên bản Engine và installer không khớp: '$EngineVersion' / '$InstallerVersion'."
}
$VersionNumbers = @($EngineVersion.Split('.') | ForEach-Object { [int]$_ }) + 0
$VersionTuple = '(' + ($VersionNumbers -join ', ') + ')'
if (-not $VersionSource.Contains("filevers=$VersionTuple") -or
    -not $VersionSource.Contains("prodvers=$VersionTuple") -or
    -not $VersionSource.Contains("StringStruct('ProductVersion', '$EngineVersion')")) {
    throw "Thông tin phiên bản Windows không khớp $EngineVersion."
}

$Ffmpeg = (Get-Command ffmpeg -ErrorAction Stop).Source
$Ffprobe = (Get-Command ffprobe -ErrorAction Stop).Source
Write-Host "FFmpeg: $Ffmpeg"
Write-Host "FFprobe: $Ffprobe"

$IconSource = Join-Path $ProjectRoot "app\assets\lat_chuyen_logo.png"
$IconOutput = Join-Path $ProjectRoot "packaging\reupai.ico"
& $Python -c "from PIL import Image; im=Image.open(r'$IconSource').convert('RGBA'); im.save(r'$IconOutput', sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])"
if ($LASTEXITCODE -ne 0) { throw "Không tạo được icon Windows." }

Push-Location $ProjectRoot
try {
    & $Python -m PyInstaller --noconfirm --clean "packaging\ReupAI.spec"
    if ($LASTEXITCODE -ne 0) { throw "PyInstaller build thất bại." }

    $Exe = Join-Path $ProjectRoot "dist\ReupAI\ReupAI.exe"
    if (-not (Test-Path -LiteralPath $Exe)) { throw "Build không tạo ReupAI.exe." }
    $RequiredBundleFiles = @(
        "_internal\app\assets\lat_chuyen_logo.png",
        "_internal\bin\ffmpeg.exe",
        "_internal\bin\ffprobe.exe"
    )
    foreach ($RelativePath in $RequiredBundleFiles) {
        $RequiredPath = Join-Path (Join-Path $ProjectRoot "dist\ReupAI") $RelativePath
        if (-not (Test-Path -LiteralPath $RequiredPath -PathType Leaf)) {
            throw "Bản đóng gói thiếu file bắt buộc: $RelativePath"
        }
    }
    $Hash = Get-FileHash -Algorithm SHA256 -LiteralPath $Exe
    $HashLine = "$($Hash.Hash.ToLower())  ReupAI.exe"
    Set-Content -LiteralPath (Join-Path $ProjectRoot "dist\ReupAI\SHA256SUMS.txt") -Value $HashLine -Encoding ascii
    Write-Host "EXE: $Exe"
    Write-Host "SHA256: $($Hash.Hash)"

    if (-not $SkipInstaller) {
        $Iscc = Get-Command iscc -ErrorAction SilentlyContinue
        $IsccPath = if ($Iscc) { $Iscc.Source } else {
            $Candidates = @(
                (Join-Path $env:LOCALAPPDATA "Programs\Inno Setup 6\ISCC.exe"),
                (Join-Path $env:ProgramFiles "Inno Setup 6\ISCC.exe"),
                (Join-Path ${env:ProgramFiles(x86)} "Inno Setup 6\ISCC.exe")
            )
            $Candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
        }
        if ($IsccPath) {
            & $IsccPath "packaging\ReupAI.iss"
            if ($LASTEXITCODE -ne 0) { throw "Inno Setup build thất bại." }
            $Installer = Join-Path $ProjectRoot "release\ReupAI-Setup-$EngineVersion.exe"
            if (-not (Test-Path -LiteralPath $Installer -PathType Leaf)) {
                throw "Installer không được tạo: $Installer"
            }
            $InstallerHash = Get-FileHash -Algorithm SHA256 -LiteralPath $Installer
            Set-Content -LiteralPath "$Installer.sha256" -Value "$($InstallerHash.Hash.ToLower())  $(Split-Path $Installer -Leaf)" -Encoding ascii
            Write-Host "Installer: $Installer"
            Write-Host "SHA256: $($InstallerHash.Hash)"
        } else {
            Write-Warning "Chưa có Inno Setup; đã tạo bản portable trong dist\ReupAI."
        }
    }
}
finally {
    Pop-Location
}
