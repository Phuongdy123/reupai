"""Regression coverage for the streamlined Local Engine authorization flow."""
from pathlib import Path
import json
import sys
import tempfile
import unittest
from unittest.mock import patch

from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "app"))
import local_engine


class LocalEngineAuthorizationTests(unittest.TestCase):
    origin = "https://www.reupai.cloud"

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.grants_path = Path(self.temp.name) / "authorization_grants.json"
        self.grants_patch = patch.object(local_engine, "AUTH_GRANTS_PATH", self.grants_path)
        self.grants_patch.start()
        self.addCleanup(self.grants_patch.stop)
        self.sessions_before = dict(local_engine._browser_sessions)
        local_engine._browser_sessions.clear()
        self.addCleanup(self._restore_sessions)

    def _restore_sessions(self):
        local_engine._browser_sessions.clear()
        local_engine._browser_sessions.update(self.sessions_before)

    def test_one_click_connect_issues_session_and_persistent_grant(self):
        result = local_engine.connect_authorization(
            {"client_origin": self.origin},
            origin=self.origin,
        )

        self.assertTrue(result["session_token"])
        self.assertTrue(result["grant"])
        self.assertEqual(result["engine"], "ReupAI")
        self.assertTrue(local_engine.require_token(f"Bearer {result['session_token']}", self.origin))
        saved = json.loads(self.grants_path.read_text(encoding="utf-8"))
        self.assertNotEqual(saved[self.origin]["fingerprint"], result["grant"])

        # Browser sessions are memory-only; a persisted grant reconnects after
        # an Engine restart without making the user connect again.
        local_engine._browser_sessions.clear()
        refreshed = local_engine.refresh_browser_session(
            {"client_origin": self.origin, "grant": result["grant"]},
            origin=self.origin,
        )
        self.assertTrue(local_engine.require_token(f"Bearer {refreshed['session_token']}", self.origin))

    def test_one_click_connect_rejects_missing_or_mismatched_origin(self):
        with self.assertRaises(HTTPException) as missing:
            local_engine.connect_authorization({"client_origin": self.origin}, origin=None)
        self.assertEqual(missing.exception.status_code, 403)

        with self.assertRaises(HTTPException) as mismatch:
            local_engine.connect_authorization(
                {"client_origin": self.origin},
                origin="https://reupai.cloud",
            )
        self.assertEqual(mismatch.exception.status_code, 403)


if __name__ == "__main__":
    unittest.main()
