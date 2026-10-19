"""Regression coverage for browser fallback in the public Local Engine."""
from pathlib import Path
import os
import sys
import unittest
from unittest.mock import patch


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "app"))
from services.sources.douyin import _browser_channel_candidates


class DouyinBrowserTests(unittest.TestCase):
    def test_default_attempts_chrome_edge_then_bundled_chromium(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(_browser_channel_candidates(), ["chrome", "msedge", None])

    def test_configured_edge_is_preferred_without_removing_fallbacks(self):
        with patch.dict(os.environ, {"REUP_BROWSER_CHANNEL": "edge"}, clear=False):
            self.assertEqual(_browser_channel_candidates(), ["msedge", "chrome", None])

    def test_configured_bundled_chromium_is_preferred(self):
        with patch.dict(os.environ, {"REUP_BROWSER_CHANNEL": "bundled"}, clear=False):
            self.assertEqual(_browser_channel_candidates(), [None, "chrome", "msedge"])


if __name__ == "__main__":
    unittest.main()
