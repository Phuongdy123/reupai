param(
    [switch]$SkipInstaller
)

$ErrorActionPreference = "Stop"
$ProjectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$Python = Join-Path $ProjectRoot "venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $Python)) {
    throw "Không tìm thấy môi trường Python: $Python"
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
        } else {
            Write-Warning "Chưa có Inno Setup; đã tạo bản portable trong dist\ReupAI."
        }
    }
}
finally {
    Pop-Location
}
