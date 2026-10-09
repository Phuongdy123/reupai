"""Compatibility entry point for the source management CLI."""

import sys
from pathlib import Path


APP_DIR = Path(__file__).resolve().parent
if str(APP_DIR) not in sys.path:
    sys.path.insert(0, str(APP_DIR))

from cli.source_manager import *  # noqa: F401,F403
from cli.source_manager import main


if __name__ == "__main__":
    main()
