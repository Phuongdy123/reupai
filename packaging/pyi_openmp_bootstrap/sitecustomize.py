"""Load CTranslate2's OpenMP DLL before Paddle in build and frozen processes."""

from __future__ import annotations

import ctypes
import importlib.util
import sys
from pathlib import Path


if sys.platform == "win32":
    if getattr(sys, "frozen", False):
        package_dir = Path(sys._MEIPASS) / "ctranslate2"
    else:
        package_spec = importlib.util.find_spec("ctranslate2")
        if package_spec is None or not package_spec.submodule_search_locations:
            raise RuntimeError("CTranslate2 is missing from the build environment.")
        package_dir = Path(next(iter(package_spec.submodule_search_locations)))

    openmp_dll = package_dir / "libiomp5md.dll"
    if not openmp_dll.is_file():
        raise RuntimeError(f"CTranslate2 OpenMP DLL is missing: {openmp_dll}")
    ctypes.CDLL(str(openmp_dll))
