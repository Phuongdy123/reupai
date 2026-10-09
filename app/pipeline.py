"""Compatibility entry point for the video processing workflow.

Keep this module so existing commands and subprocess integrations continue to
work while the implementation lives in :mod:`core.pipeline`.
"""

import sys
from pathlib import Path


APP_DIR = Path(__file__).resolve().parent
if str(APP_DIR) not in sys.path:
    sys.path.insert(0, str(APP_DIR))

from core.pipeline import *  # noqa: F401,F403
from core.pipeline import main


if __name__ == "__main__":
    main()
