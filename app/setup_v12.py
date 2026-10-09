"""Compatibility entry point for the V12 database setup CLI."""

import sys
from pathlib import Path


APP_DIR = Path(__file__).resolve().parent
if str(APP_DIR) not in sys.path:
    sys.path.insert(0, str(APP_DIR))

from cli.setup_v12 import *  # noqa: F401,F403
from cli.setup_v12 import main


if __name__ == "__main__":
    main()
