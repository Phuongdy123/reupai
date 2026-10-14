"""Install the local stability patch for an already-installed Engine.

This is intentionally local-only.  It writes a hash-pinned patch into the
runtime directory; the Engine must be restarted before it is loaded.
"""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path


runtime_root = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local")) / "ReupAI"
patch_dir = runtime_root / "patches"
patch_dir.mkdir(parents=True, exist_ok=True)
patch_path = patch_dir / "no_console_subprocess.py"

patch_source = '''"""Hide Windows console windows and stabilise local media tools."""

def apply():
    import os
    import subprocess

    if os.name != "nt" or getattr(subprocess, "_reupai_no_console", False):
        return
    original_popen = subprocess.Popen
    no_window = getattr(subprocess, "CREATE_NO_WINDOW", 0)

    def stabilise_bilibili(command):
        if not isinstance(command, (list, tuple)):
            return command
        values = list(command)
        if ("--python-module" not in values or "yt_dlp" not in values or
                not any("bilibili.com/" in str(value) for value in values)):
            return command
        try:
            format_index = values.index("-f") + 1
            values[format_index] = "bv*[height<=720]+ba/b"
        except (ValueError, IndexError):
            pass
        try:
            fragment_index = values.index("--concurrent-fragments") + 1
            values[fragment_index] = "1"
        except (ValueError, IndexError):
            try:
                merge_index = values.index("--merge-output-format")
                values[merge_index:merge_index] = ["--concurrent-fragments", "1"]
            except ValueError:
                pass
        return values

    def stabilise_boxblur(command):
        """Clamp FFmpeg boxblur radii to the cropped region's YUV limits."""
        if not isinstance(command, (list, tuple)):
            return command
        values = list(command)
        executable = str(values[0]).lower() if values else ""
        if "ffmpeg" not in executable:
            return values
        try:
            filter_index = values.index("-filter_complex") + 1
            graph = str(values[filter_index])
        except (ValueError, IndexError):
            return values

        import re

        # The first four groups are crop geometry; the last two are boxblur.
        pattern = r"crop=(\\d+):(\\d+):(\\d+):(\\d+),boxblur=(\\d+):(\\d+)"
        def clamp_region(match):
            width = int(match.group(1))
            height = int(match.group(2))
            radius = int(match.group(5))
            power = int(match.group(6))
            maximum = max(0, (min(width, height) // 4) - 1)
            return "crop={}:{}:{}:{},boxblur={}:{}".format(
                match.group(1), match.group(2), match.group(3), match.group(4),
                min(radius, maximum), max(1, power)
            )
        values[filter_index] = re.sub(pattern, clamp_region, graph)
        return values

    class HiddenPopen(original_popen):
        def __init__(self, *args, **kwargs):
            flags = int(kwargs.get("creationflags", 0) or 0)
            kwargs["creationflags"] = flags | no_window
            if args:
                command = stabilise_bilibili(args[0])
                args = (stabilise_boxblur(command), *args[1:])
            elif "args" in kwargs:
                command = stabilise_bilibili(kwargs["args"])
                kwargs["args"] = stabilise_boxblur(command)
            super().__init__(*args, **kwargs)

    subprocess.Popen = HiddenPopen
    subprocess._reupai_no_console = True
'''

patch_path.write_text(patch_source, encoding="utf-8")
checksum = hashlib.sha256(patch_path.read_bytes()).hexdigest()
(patch_dir / "manifest.json").write_text(
    json.dumps(
        {"patches": [{"file": patch_path.name, "sha256": checksum}]},
        indent=2,
    ),
    encoding="utf-8",
)
print("NO_CONSOLE_PATCH_READY")
