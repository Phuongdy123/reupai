"""Local, manifest-controlled runtime patches for packaged ReupAI releases.

The Engine never downloads or writes patches itself.  A user-installed patch is
only loaded after its SHA-256 matches the local manifest, and it runs before
the Engine imports the pipeline modules.
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import re
import traceback
from pathlib import Path
from typing import Any

from runtime_paths import get_logs_dir, get_runtime_root


_SAFE_FILENAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]*\.py$")


def _write_log(message: str) -> None:
    try:
        log_path = get_logs_dir() / "runtime-patches.log"
        log_path.parent.mkdir(parents=True, exist_ok=True)
        with log_path.open("a", encoding="utf-8") as log_file:
            log_file.write(message.rstrip() + "\n")
    except OSError:
        pass


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as patch_file:
        for block in iter(lambda: patch_file.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def apply_runtime_patches() -> list[str]:
    """Load local patches listed in runtime ``patches/manifest.json``.

    Each patch must export ``apply()``.  Errors leave the Engine running and
    are written to the local log without exposing configuration values.
    """
    patch_dir = get_runtime_root() / "patches"
    manifest_path = patch_dir / "manifest.json"
    if not manifest_path.is_file():
        return []

    try:
        manifest: dict[str, Any] = json.loads(manifest_path.read_text(encoding="utf-8"))
        entries = manifest.get("patches", [])
        if not isinstance(entries, list):
            raise ValueError("'patches' must be a list")
    except Exception as error:
        _write_log(f"[patch-loader] Invalid manifest: {type(error).__name__}")
        return []

    patch_root = patch_dir.resolve()
    applied: list[str] = []
    for index, entry in enumerate(entries):
        if not isinstance(entry, dict):
            _write_log(f"[patch-loader] Skipped entry {index}: invalid type")
            continue
        filename = entry.get("file")
        expected_hash = str(entry.get("sha256", "")).lower()
        if not isinstance(filename, str) or not _SAFE_FILENAME.fullmatch(filename):
            _write_log(f"[patch-loader] Skipped entry {index}: invalid filename")
            continue
        if not re.fullmatch(r"[0-9a-f]{64}", expected_hash):
            _write_log(f"[patch-loader] Skipped {filename}: invalid SHA-256")
            continue

        patch_path = (patch_root / filename).resolve()
        if patch_path.parent != patch_root or not patch_path.is_file():
            _write_log(f"[patch-loader] Skipped {filename}: file unavailable")
            continue
        if _sha256(patch_path) != expected_hash:
            _write_log(f"[patch-loader] Skipped {filename}: checksum mismatch")
            continue

        module_name = f"reupai_runtime_patch_{index}_{patch_path.stem}"
        try:
            spec = importlib.util.spec_from_file_location(module_name, patch_path)
            if spec is None or spec.loader is None:
                raise RuntimeError("cannot create module spec")
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            apply = getattr(module, "apply", None)
            if not callable(apply):
                raise RuntimeError("missing apply()")
            apply()
            applied.append(filename)
            _write_log(f"[patch-loader] Applied {filename}")
        except Exception as error:
            _write_log(
                f"[patch-loader] Failed {filename}: {type(error).__name__}\n"
                + traceback.format_exc(limit=3)
            )
    return applied
