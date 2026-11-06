"""Gemini OAuth must recover stale access tokens without consent loops."""

import base64
import json
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "app"))
from services import gemini_oauth


class GeminiOAuthTests(unittest.TestCase):
    def test_identity_hint_is_read_from_google_id_token(self):
        claims = base64.urlsafe_b64encode(json.dumps({
            "email": "user@example.com", "sub": "google-user-1",
        }).encode()).decode().rstrip("=")
        identity = gemini_oauth._identity_from_id_token(f"header.{claims}.signature")
        self.assertEqual(identity["_reupai_google_email"], "user@example.com")
        self.assertEqual(identity["_reupai_google_subject"], "google-user-1")

    @patch.object(gemini_oauth.requests, "request")
    @patch.object(gemini_oauth, "refresh_credentials", return_value=SimpleNamespace(token="fresh"))
    @patch.object(gemini_oauth, "get_credentials", return_value=SimpleNamespace(token="stale"))
    def test_401_refreshes_once_and_replays_request(self, _get, _refresh, request):
        request.side_effect = [SimpleNamespace(status_code=401), SimpleNamespace(status_code=200)]
        result = gemini_oauth.authorized_request("GET", "https://example.test", project_id="demo-project")
        self.assertEqual(result.status_code, 200)
        self.assertEqual(request.call_count, 2)
        self.assertEqual(request.call_args_list[0].kwargs["headers"]["Authorization"], "Bearer stale")
        self.assertEqual(request.call_args_list[1].kwargs["headers"]["Authorization"], "Bearer fresh")

    @patch.object(gemini_oauth, "verify_gemini_access", return_value={"state": "ready", "ready": True})
    def test_repair_does_nothing_when_access_is_ready(self, verify):
        self.assertTrue(gemini_oauth.repair_gemini_access()["ready"])
        verify.assert_called_once_with()

    @patch.object(gemini_oauth, "enable_gemini_api", return_value={"state": "enabling", "ready": False})
    @patch.object(gemini_oauth, "verify_gemini_access", return_value={"state": "disabled", "ready": False})
    def test_repair_reuses_diagnostic_instead_of_checking_twice(self, verify, enable):
        result = gemini_oauth.repair_gemini_access()
        verify.assert_called_once_with()
        enable.assert_called_once_with(current={"state": "disabled", "ready": False})
        self.assertEqual(result["action"], "retry")


if __name__ == "__main__":
    unittest.main()
