"""Regression coverage for batched Collection writes."""
from pathlib import Path
from types import SimpleNamespace
import sys
import unittest
from unittest.mock import patch

from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "app"))
from services import library_api


class CollectionBatchTests(unittest.TestCase):
    def setUp(self):
        self.request = SimpleNamespace(
            state=SimpleNamespace(user={"id": 7, "role": "local"})
        )

    def test_batch_upserts_each_video_and_writes_collection_once(self):
        body = library_api.CollectionVideosBody(
            videos=[
                library_api.CollectionVideoBody(video_id="BVone", title="Một"),
                library_api.CollectionVideoBody(video_id="BVtwo", title="Hai"),
            ]
        )
        with patch.object(library_api, "upsert_video_dict") as upsert, patch.object(
            library_api, "add_videos_to_collection", return_value=2
        ) as add:
            result = library_api.api_add_collection_videos(3, body, self.request)

        self.assertEqual(result, {"ok": True, "accepted": 2})
        self.assertEqual(upsert.call_count, 2)
        add.assert_called_once_with(7, 3, ["BVone", "BVtwo"])

    def test_batch_rejects_empty_and_oversized_requests(self):
        with self.assertRaises(HTTPException) as empty:
            library_api.api_add_collection_videos(
                3, library_api.CollectionVideosBody(videos=[]), self.request
            )
        self.assertEqual(empty.exception.status_code, 400)

        oversized = library_api.CollectionVideosBody(
            videos=[library_api.CollectionVideoBody(video_id=f"BV{index}") for index in range(201)]
        )
        with self.assertRaises(HTTPException) as too_many:
            library_api.api_add_collection_videos(3, oversized, self.request)
        self.assertEqual(too_many.exception.status_code, 400)


if __name__ == "__main__":
    unittest.main()
