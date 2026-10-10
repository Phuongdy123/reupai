r"""Centralized local storage paths for development and packaged builds.

Development keeps the existing project layout. Production can set
REUP_DATA_DIR or REUP_ENV=production to use %LOCALAPPDATA%\ReupAI.
"""

import os
import shutil
from pathlib import Path


APP_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = APP_DIR.parent


def _production_root() -> Path:
    override = os.getenv("REUP_DATA_DIR", "").strip()
    if override:
        return Path(override).expanduser().resolve()
    local_app_data = os.getenv("LOCALAPPDATA", "").strip()
    if local_app_data:
        return Path(local_app_data) / "ReupAI"
    return Path.home() / "AppData" / "Local" / "ReupAI"


def is_production() -> bool:
    return os.getenv("REUP_ENV", "development").strip().lower() in {
        "production",
        "prod",
    }


def get_runtime_root() -> Path:
    if is_production() or os.getenv("REUP_DATA_DIR", "").strip():
        return _production_root()
    return APP_DIR


def get_data_dir() -> Path:
    return get_runtime_root() / "data"


def get_downloads_dir() -> Path:
    return get_runtime_root() / "downloads"


def get_projects_dir() -> Path:
    return get_runtime_root() / "projects"


def get_output_dir() -> Path:
    return get_runtime_root() / "output"


def get_temp_dir() -> Path:
    return get_runtime_root() / "temp"


def get_models_dir() -> Path:
    return get_runtime_root() / "models"


def get_browser_dir() -> Path:
    return get_runtime_root() / "browser"


def get_logs_dir() -> Path:
    return get_runtime_root() / "logs"


def get_channels_dir() -> Path:
    return get_runtime_root() / "channels"


def get_jobs_dir() -> Path:
    return get_runtime_root() / "jobs"


def get_config_dir() -> Path:
    return get_runtime_root() / "config"


def get_local_token_path() -> Path:
    return get_runtime_root() / "local_token"


def ensure_runtime_dirs() -> None:
    migrate_legacy_runtime()
    for path in (
        get_data_dir(),
        get_downloads_dir(),
        get_projects_dir(),
        get_output_dir(),
        get_temp_dir(),
        get_logs_dir(),
        get_models_dir(),
        get_browser_dir(),
        get_channels_dir(),
        get_jobs_dir(),
        get_config_dir(),
    ):
        path.mkdir(parents=True, exist_ok=True)


def migrate_legacy_runtime() -> None:
    """Copy legacy app-local runtime data into an empty packaged root safely.

    Development keeps the existing ``app/`` layout.  When a production root
    is selected, only files that do not already exist at the destination are
    copied; newer destination data is never overwritten.
    """
    root = get_runtime_root()
    if root == APP_DIR or not is_production() and not os.getenv("REUP_DATA_DIR", "").strip():
        return
    legacy = APP_DIR
    if not legacy.exists() or root.exists() and (root / ".migration-complete").exists():
        return

    copied = 0
    for name in ("data", "downloads", "projects", "output", "temp", "channels", "jobs", "models", "browser", "logs", "config"):
        source = legacy / name
        destination = root / name
        if not source.exists():
            continue
        for item in source.rglob("*"):
            if not item.is_file():
                continue
            target = destination / item.relative_to(source)
            if target.exists():
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(item, target)
            copied += 1
    root.mkdir(parents=True, exist_ok=True)
    (root / ".migration-complete").write_text(
        f"legacy runtime migration complete; copied_files={copied}\n",
        encoding="utf-8",
    )
