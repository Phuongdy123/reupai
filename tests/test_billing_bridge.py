"""Checks the Local Engine's fail-closed billing handshake and retry path."""

from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "app"))
from services import billing
from web.server import ProcessRequest


class BillingBridgeTests(unittest.TestCase):
    def test_claim_requires_opaque_token_and_confirmed_reservation(self):
        with self.assertRaises(billing.BillingUnavailable):
            billing.claim("", "BV123", "subtitle")
        with patch.object(billing, "_request", return_value={"allowed": False}):
            with self.assertRaises(billing.BillingUnavailable):
                billing.claim("x" * 43, "BV123", "subtitle")
        with patch.object(billing, "_request", return_value={"allowed": True}) as request:
            billing.claim("x" * 43, "BV123", "subtitle")
            self.assertEqual(request.call_args.args[0], "/api/billing/jobs/claim")

    def test_finish_retries_temporary_outage(self):
        with patch.object(billing, "_request", side_effect=[billing.BillingUnavailable("offline"), {"ok": True}]) as request, patch.object(billing.time, "sleep"):
            self.assertTrue(billing.finish("x" * 43, "completed"))
            self.assertEqual(request.call_count, 2)

    def test_process_options_reject_unknown_styles(self):
        ProcessRequest(url="https://example.com/video", video_id="BV123", source_language="ja", subtitle_style="cinema")
        with self.assertRaises(Exception):
            ProcessRequest(url="https://example.com/video", video_id="BV123", subtitle_style="not-a-style")


if __name__ == "__main__":
    unittest.main()
