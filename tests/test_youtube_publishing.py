import json
from pathlib import Path
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch, Mock
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "app"))
from services import youtube_publishing as youtube


class ImmediateThread:
    def __init__(self, target, **kwargs):
        self.target = target
    def start(self):
        self.target()


class YoutubePublishingTests(unittest.TestCase):
    def payload(self, **values):
        return {"request_id": str(uuid.uuid4()), "confirmed": True, "title": "Video thử",
                "description": "Nội dung thử", "tags": ["vietsub"], "made_for_kids": False,
                "privacy": "private", **values}

    def test_requires_explicit_audience_and_valid_limits(self):
        for values in ({"made_for_kids": None}, {"title": "x" * 101},
                       {"description": "ệ" * 2000}, {"privacy": "other"},
                       {"publish_at": "2020-01-01T00:00:00Z"}):
            with self.subTest(values=values), self.assertRaises(ValueError):
                youtube.validate_metadata(self.payload(**values))
        self.assertEqual(youtube.validate_metadata(self.payload())["status"]["privacyStatus"], "private")

    def test_schedule_is_always_uploaded_as_private(self):
        metadata = youtube.validate_metadata(self.payload(privacy="public", publish_at="2099-01-01T00:00:00Z"))
        self.assertEqual(metadata["status"]["privacyStatus"], "private")
        self.assertIn("publishAt", metadata["status"])

    def test_owner_paths_cannot_escape_or_access_another_account(self):
        first, second = str(uuid.uuid4()), str(uuid.uuid4())
        self.assertNotEqual(youtube._root(first), youtube._root(second))
        with self.assertRaises(ValueError):
            youtube._root("../../other-account")

    def test_upload_is_private_and_same_request_cannot_upload_twice(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            video = root / "final_sub.mp4"; video.write_bytes(b"fixture-only-video")
            owner = str(uuid.uuid4()); payload = self.payload(account_id=owner, channel_id="channel-fixture")
            init = Mock(ok=True, headers={"Location": "https://www.googleapis.com/upload/youtube/v3/videos?upload_id=fixture"})
            done = Mock(status_code=201)
            done.json.return_value = {"id": "abcdefghijk", "status": {"privacyStatus": "private"}}
            with patch.object(youtube, "_root", return_value=root / "account"), \
                 patch.object(youtube, "_load", return_value={"channel": {"id": "channel-fixture"}}), \
                 patch.object(youtube, "_credentials", return_value=SimpleNamespace(token="test-only")), \
                 patch.object(youtube, "_channel", return_value={"id": "channel-fixture", "title": "Kênh thử"}), \
                 patch.object(youtube.threading, "Thread", ImmediateThread), \
                 patch.object(youtube.requests, "post", return_value=init) as insert, \
                 patch.object(youtube.requests, "put", return_value=done):
                result = youtube.start_upload(owner, video, payload)
                self.assertEqual(result["state"], "completed")
                self.assertEqual(insert.call_args.kwargs["json"]["status"]["privacyStatus"], "private")
                repeated = youtube.start_upload(owner, video, payload)
                self.assertEqual(repeated["id"], result["id"])
                self.assertEqual(insert.call_count, 1)
                with self.assertRaises(ValueError):
                    youtube.start_upload(owner, video, {**payload, "title": "Different title"})

    def test_missing_confirmation_does_not_contact_youtube(self):
        with patch.object(youtube.requests, "post") as post:
            with self.assertRaises(ValueError):
                youtube.start_upload(str(uuid.uuid4()), Path("unused.mp4"), self.payload(confirmed=False))
            post.assert_not_called()

    def test_changed_cloud_account_cannot_post_from_an_old_dialog(self):
        owner = str(uuid.uuid4())
        with patch.object(youtube, "_credentials") as credentials:
            with self.assertRaises(PermissionError):
                youtube.start_upload(owner, Path("unused.mp4"), self.payload(account_id=str(uuid.uuid4())))
            credentials.assert_not_called()

    def test_changed_youtube_channel_requires_reviewing_the_new_target(self):
        owner = str(uuid.uuid4())
        with patch.object(youtube, "_credentials", return_value=SimpleNamespace(token="test-only")), \
             patch.object(youtube, "_channel", return_value={"id": "new-channel", "title": "New"}), \
             patch.object(youtube.requests, "post") as post:
            with self.assertRaisesRegex(ValueError, "Kênh YouTube đã thay đổi"):
                youtube.start_upload(owner, Path("unused.mp4"), self.payload(account_id=owner, channel_id="old-channel"))
            post.assert_not_called()

    def test_revoked_consent_prompts_reconnection_without_deleting_other_accounts(self):
        owner = str(uuid.uuid4())
        with patch.object(youtube, "_load", return_value={"channel": {"id": "channel", "title": "Test"}}), \
             patch.object(youtube, "_credentials", side_effect=PermissionError("revoked")), \
             patch.object(youtube, "_client_config", return_value={"installed": {}}):
            result = youtube.connection_status(owner)
            self.assertFalse(result["connected"])
            self.assertTrue(result["needs_reauthorization"])
            self.assertEqual(result["account_id"], owner)

    def test_untrusted_upload_host_is_never_contacted(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); video = root / "final_sub.mp4"; video.write_bytes(b"fixture")
            init = Mock(ok=True, headers={"Location": "http://127.0.0.1:8080/internal"})
            owner = str(uuid.uuid4())
            with patch.object(youtube, "_root", return_value=root / "account"), \
                 patch.object(youtube, "_load", return_value={"channel": {"id": "fixture"}}), \
                 patch.object(youtube, "_credentials", return_value=SimpleNamespace(token="test-only")), \
                 patch.object(youtube, "_channel", return_value={"id": "fixture", "title": "Test"}), \
                 patch.object(youtube.threading, "Thread", ImmediateThread), \
                 patch.object(youtube.requests, "post", return_value=init), \
                 patch.object(youtube.requests, "put") as put:
                result = youtube.start_upload(owner, video, self.payload(account_id=owner, channel_id="fixture"))
                self.assertEqual(result["state"], "failed")
                put.assert_not_called()


if __name__ == "__main__":
    unittest.main()
