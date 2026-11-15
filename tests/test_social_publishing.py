import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "app"))
from services import social_publishing as social


class SocialPublishingTests(unittest.TestCase):
    def test_publish_requires_confirmation_and_matching_destination(self):
        with patch.object(social, "destination", return_value={"id": "verified", "name": "Page"}) as target, \
                patch.object(social.threading, "Thread") as thread:
            with self.assertRaises(ValueError):
                social.start("owner", "facebook", {}, None)
            target.assert_not_called()
            with self.assertRaises(PermissionError):
                social.start("owner", "facebook", {"confirmed": True, "request_id": str(uuid.uuid4()),
                    "message": "Bài thử", "target_id": "other", "token": "test-token"}, None)
            thread.assert_not_called()

    def test_facebook_text_post_uses_page_feed(self):
        response = Mock(is_success=True, status_code=200)
        response.json.return_value = {"id": "123_456"}
        with patch.object(social.httpx, "post", return_value=response) as send:
            result = social._facebook("fixture-token", "123", "Nội dung thử", None)
        self.assertEqual(send.call_args.args[0], f"{social.FACEBOOK}/123/feed")
        self.assertEqual(send.call_args.kwargs["data"], {"message": "Nội dung thử"})
        self.assertEqual(result["url"], "https://www.facebook.com/123_456")

    def test_tiktok_uploads_final_remainder_and_returns_draft_status(self):
        chunk = 16 * 1024 ** 2
        response = Mock(is_success=True, status_code=200)
        response.json.return_value = {"data": {"upload_url": "https://upload.us.tiktokapis.com/video/?upload_id=demo",
                                                "publish_id": "draft-id"}, "error": {"code": "ok"}}
        with tempfile.TemporaryDirectory() as path, patch.object(social.httpx, "post", return_value=response) as init, \
                patch.object(social.httpx, "Client") as client:
            video = Path(path) / "sample.mp4"
            size = 2 * chunk + 23
            with video.open("wb") as source:
                source.truncate(size)
            put = client.return_value.__enter__.return_value.put
            put.side_effect = [Mock(status_code=206), Mock(status_code=201)]
            result = social._tiktok("fixture-token", video, lambda _value: None)
        self.assertEqual(init.call_args.kwargs["json"]["source_info"]["total_chunk_count"], 2)
        self.assertEqual(put.call_args.kwargs["headers"]["Content-Range"], f"bytes {chunk}-{size - 1}/{size}")
        self.assertEqual(result, {"state": "sent", "publish_id": "draft-id"})


if __name__ == "__main__":
    unittest.main()
