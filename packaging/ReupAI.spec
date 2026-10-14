# -*- mode: python ; coding: utf-8 -*-
from pathlib import Path
import shutil
from importlib.util import find_spec

from PyInstaller.utils.hooks import collect_all, copy_metadata


ROOT = Path(SPECPATH).resolve().parent
APP = ROOT / "app"

datas = [
    (str(APP / "web" / "templates"), "web/templates"),
    (str(APP / "web" / "static"), "web/static"),
    (str(APP / "assets"), "app/assets"),
    (str(APP / "models"), "models"),
]
binaries = []
hiddenimports = []

# PaddleX checks installed distribution metadata (not only importability)
# before constructing OCR readers and post-processors.  PyInstaller can bundle
# the import package while omitting dist-info, which makes PaddleX report the
# dependency as unavailable at runtime.
for distribution in (
    "pypdfium2",
    "soundfile",
    "sea-g2p",
    "pyclipper",
    "shapely",
    "opencv-contrib-python",
    "python-bidi",
    "imagesize",
):
    datas += copy_metadata(distribution)

for package in (
    "faster_whisper",
    "ctranslate2",
    "tokenizers",
    "onnxruntime",
    "vieneu",
    "vieneu_utils",
    "sea_g2p",
    "paddleocr",
    "paddlex",
    "paddle",
    "cv2",
    "pyclipper",
    "shapely",
    "yt_dlp",
    "playwright",
    "edge_tts",
    "google.genai",
    "pystray",
):
    package_datas, package_binaries, package_hidden = collect_all(package)
    datas += package_datas
    binaries += package_binaries
    hiddenimports += package_hidden

# VieNeu opens this Rust dictionary by path next to sea_g2p/g2p.py.
# PyInstaller can import the module successfully while silently omitting it.
sea_g2p_spec = find_spec("sea_g2p")
if sea_g2p_spec is None or sea_g2p_spec.origin is None:
    raise SystemExit("Missing sea_g2p package required by VieNeu TTS.")
sea_g2p_dictionary = Path(sea_g2p_spec.origin).parent / "sea_g2p.bin"
if not sea_g2p_dictionary.is_file():
    raise SystemExit("Missing sea_g2p.bin required by VieNeu TTS.")
datas.append((str(sea_g2p_dictionary), "sea_g2p"))

for tool in ("ffmpeg", "ffprobe"):
    executable = shutil.which(tool)
    if not executable:
        raise SystemExit(f"Không tìm thấy {tool} trong PATH.")
    binaries.append((executable, "bin"))

icon_path = ROOT / "packaging" / "reupai.ico"

a = Analysis(
    [str(APP / "desktop_entry.py")],
    pathex=[str(APP), str(ROOT)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    excludes=["tkinter", "pytest", "IPython"],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="ReupAI",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    icon=str(icon_path) if icon_path.exists() else None,
    version=str(ROOT / "packaging" / "version_info.txt"),
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    name="ReupAI",
)
