from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "app"))
from services import social_identity


class SocialIdentityTests(unittest.TestCase):
    def setUp(self):
        social_identity._cache.clear()

    def test_owner_is_verified_remotely_and_cached_per_token(self):
        first, second = str(uuid.uuid4()), str(uuid.uuid4())
        response_a = Mock(ok=True, status_code=200); response_a.json.return_value = {"userId": first}
        response_b = Mock(ok=True, status_code=200); response_b.json.return_value = {"userId": second}
        with patch.object(social_identity.requests, "get", side_effect=[response_a, response_b]) as verify:
            self.assertEqual(social_identity.account_for_token("fixture-token-a"), first)
            self.assertEqual(social_identity.account_for_token("fixture-token-a"), first)
            self.assertEqual(social_identity.account_for_token("fixture-token-b"), second)
            self.assertEqual(verify.call_count, 2)
            self.assertEqual(verify.call_args.kwargs["headers"]["Authorization"], "Bearer fixture-token-b")

    def test_invalid_session_and_missing_token_never_access_a_local_account(self):
        with self.assertRaises(PermissionError):
            social_identity.account_for_token("")
        with patch.object(social_identity.requests, "get", return_value=Mock(ok=False, status_code=401)):
            with self.assertRaises(PermissionError):
                social_identity.account_for_token("expired-fixture-token")
        self.assertFalse(social_identity._cache)


if __name__ == "__main__":
    unittest.main()
