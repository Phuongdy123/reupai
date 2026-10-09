"""Resource-conscious settings shared by the web and CLI download paths."""

import os
from pathlib import Path

from dotenv import load_dotenv


PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
load_dotenv(PROJECT_ROOT / ".env")


def _bounded_int(name: str, default: int, *, minimum: int, maximum: int) -> int:
    try:
        value = int(os.getenv(name, str(default)).strip())
    except (TypeError, ValueError):
        value = default
    return max(minimum, min(value, maximum))


def ytdlp_performance_args() -> list[str]:
    """Return conservative yt-dlp speed options with an optional chunk override."""
    fragments = _bounded_int(
        "REUP_YTDLP_CONCURRENT_FRAGMENTS",
        2,
        minimum=1,
        maximum=8,
    )
    args = ["--concurrent-fragments", str(fragments)]

    # Preserve the project's existing 2M setting, while letting users turn
    # it off when the source does not benefit from chunked HTTP requests.
    chunk_size = os.getenv("REUP_HTTP_CHUNK_SIZE", "2M").strip()
    if chunk_size.lower() not in {"", "off", "false", "none", "0"}:
        args.extend(["--http-chunk-size", chunk_size])

    return args


def max_parallel_downloads() -> int:
    return _bounded_int(
        "REUP_MAX_PARALLEL_DOWNLOADS",
        1,
        minimum=1,
        maximum=4,
    )


def max_parallel_pipelines() -> int:
    return _bounded_int(
        "REUP_MAX_PARALLEL_PIPELINES",
        1,
        minimum=1,
        maximum=4,
    )
