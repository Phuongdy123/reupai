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
    @staticmethod
    def response(code=403, reason=None, metadata=None, message="private account detail"):
        body = {"error": {"message": message, "details": ([{
            "@type": "type.googleapis.com/google.rpc.ErrorInfo", "reason": reason,
            "metadata": metadata or {},
        }] if reason else [])}}
        return SimpleNamespace(ok=200 <= code < 300, status_code=code, json=lambda: body)

    def test_google_403_reasons_require_different_remedies(self):
        cases = [
            ("ACCESS_TOKEN_SCOPE_INSUFFICIENT", {}, "reauthorization_required", "reauthorize"),
            ("IAM_PERMISSION_DENIED", {"permission": "serviceusage.services.enable"}, "administrator_required", "open_project_permissions"),
            ("USER_PROJECT_DENIED", {"permission": "serviceusage.services.use"}, "quota_permission_required", "open_project_permissions"),
            ("TOS_NOT_ACCEPTED", {}, "terms_required", "open_cloud_console"),
            ("BILLING_DISABLED", {}, "billing_required", "open_billing"),
            ("ORG_POLICY_VIOLATION", {}, "organization_policy_required", "open_project_permissions"),
            ("SERVICE_DISABLED", {"service": "serviceusage.googleapis.com"}, "setup_service_disabled", "open_setup_api"),
            ("UNRECOGNIZED", {}, "permission_denied", "open_project_permissions"),
        ]
        for reason, metadata, state, action in cases:
            with self.subTest(reason=reason):
                result = gemini_oauth._setup_failure(self.response(reason=reason, metadata=metadata), "customer-project", enabling=True)
                self.assertEqual(result["state"], state)
                self.assertEqual(result["action"], action)
                self.assertFalse(result["ready"])
                self.assertNotIn("private account detail", str(result))

    def test_service_disabled_on_another_api_is_not_gemini_disabled(self):
        self.assertFalse(gemini_oauth._is_api_disabled(self.response(reason="SERVICE_DISABLED", metadata={"service": "serviceusage.googleapis.com"})))
        self.assertTrue(gemini_oauth._is_api_disabled(self.response(reason="SERVICE_DISABLED", metadata={"service": "generativelanguage.googleapis.com"})))

    def test_transient_errors_retry_without_requesting_consent(self):
        for code in (429, 500, 503):
            result = gemini_oauth._setup_failure(self.response(code), "customer-project", enabling=True)
            self.assertEqual(result["action"], "retry")
            self.assertTrue(result["retryable"])

    def test_unstructured_or_malformed_denial_does_not_claim_missing_admin_role(self):
        for payload in ({"error": {"details": None}}, {"error": "invalid"}, [], {}):
            response = SimpleNamespace(status_code=403, json=lambda: payload)
            self.assertEqual(gemini_oauth._setup_failure(response, "customer-project", enabling=True)["state"], "permission_denied")
            self.assertFalse(gemini_oauth._is_api_disabled(response))

    @patch.object(gemini_oauth, "authorized_request")
    @patch.object(gemini_oauth, "get_project_id", return_value="customer-project")
    @patch.object(gemini_oauth, "get_credentials", return_value=SimpleNamespace(token="fixture-only"))
    def test_enable_targets_resource_without_requiring_quota_header(self, _credentials, _project, request):
        request.return_value = self.response(200)
        result = gemini_oauth.enable_gemini_api({"state": "disabled", "ready": False})
        self.assertEqual(result["state"], "enabling")
        self.assertEqual(request.call_args.args, ("POST", "https://serviceusage.googleapis.com/v1/projects/customer-project/services/generativelanguage.googleapis.com:enable"))
        self.assertNotIn("project_id", request.call_args.kwargs)

    @patch.object(gemini_oauth, "authorized_request")
    @patch.object(gemini_oauth, "get_project_id", return_value="customer-project")
    @patch.object(gemini_oauth, "get_credentials", return_value=SimpleNamespace(token="fixture-only"))
    def test_enable_passes_scope_denial_to_reconnect_instead_of_admin(self, _credentials, _project, request):
        request.return_value = self.response(reason="ACCESS_TOKEN_SCOPE_INSUFFICIENT")
        result = gemini_oauth.enable_gemini_api({"state": "disabled", "ready": False})
        self.assertEqual(result["action"], "reauthorize")

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
