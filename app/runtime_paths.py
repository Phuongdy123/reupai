r"""Centralized local storage paths for development and packaged builds.

Development keeps the existing project layout. Production can set
REUP_DATA_DIR or REUP_ENV=production to use %LOCALAPPDATA%\ReupAI.
"""

import os
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


def ensure_runtime_dirs() -> None:
    for path in (
        get_data_dir(),
        get_downloads_dir(),
        get_projects_dir(),
        get_output_dir(),
        get_temp_dir(),
        get_logs_dir(),
    ):
        path.mkdir(parents=True, exist_ok=True)
