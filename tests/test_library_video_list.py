"""Regression coverage for scalable local library reads."""
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "app"))
from services import library_db


class LibraryVideoListTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        self.db_path = self.root / "library.sqlite"
        self.connection_calls = 0

        self.download_root = self.root / "downloads" / "demo"
        self.channels_root = self.root / "channels"
        self.connection_patch = patch.object(
            library_db,
            "get_connection",
            side_effect=self._connection,
        )
        self.download_patch = patch.object(
            library_db,
            "DOWNLOAD_ROOT",
            self.download_root,
        )
        self.channels_patch = patch.object(
            library_db,
            "CHANNELS_ROOT",
            self.channels_root,
        )
        self.connection_patch.start()
        self.download_patch.start()
        self.channels_patch.start()
        self.addCleanup(self.connection_patch.stop)
        self.addCleanup(self.download_patch.stop)
        self.addCleanup(self.channels_patch.stop)
        self.addCleanup(self.temp_dir.cleanup)

    def _connection(self):
        self.connection_calls += 1
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _upsert(self, video_id, *, published_at, source_id=1):
        library_db.upsert_video(
            video_id=video_id,
            platform="bilibili",
            url=f"https://example.test/{video_id}",
            title=video_id,
            source_id=source_id,
            source_name="Nguồn thử nghiệm",
            published_at=published_at,
        )

    def test_favorite_filter_happens_before_limit(self):
        self._upsert("newest", published_at="2026-01-01T00:00:00")
        self._upsert("favorite", published_at="2025-01-01T00:00:00")

        conn = self._connection()
        try:
            conn.execute(
                """
                INSERT INTO favorites (user_id, platform_video_id, status, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (7, "favorite", "favorite", "2026-01-01", "2026-01-01"),
            )
            conn.commit()
        finally:
            conn.close()

        with patch.object(library_db, "sync_source_videos"):
            videos = library_db.list_library_videos(7, favorite=True, limit=1)

        self.assertEqual([video["video_id"] for video in videos], ["favorite"])
        self.assertTrue(videos[0]["favorite"])

    def test_local_states_fetch_job_status_once_for_many_videos(self):
        source = self.download_root / "first" / "source.mp4"
        source.parent.mkdir(parents=True)
        source.write_bytes(b"video")
        subtitle = self.channels_root / "3d_animation" / "jobs" / "first" / "final_sub.mp4"
        subtitle.parent.mkdir(parents=True)
        subtitle.write_bytes(b"render")

        with patch.object(
            library_db,
            "_latest_job_statuses",
            return_value={"first": "processing", "second": "completed"},
        ) as statuses:
            states = library_db.local_video_states(
                [("first", "3d_animation"), ("second", "comedy")]
            )

        self.assertEqual(statuses.call_count, 1)
        self.assertTrue(states["first"]["downloaded"])
        self.assertTrue(states["first"]["has_subtitle_result"])
        self.assertTrue(states["first"]["processing"])
        self.assertEqual(states["first"]["channel_key"], "3d_animation")
        self.assertFalse(states["second"]["processing"])
        self.assertEqual(states["second"]["db_status"], "completed")

    def test_source_sync_uses_one_shared_transaction(self):
        conn = self._connection()
        try:
            conn.executescript(
                """
                CREATE TABLE sources (
                    id INTEGER PRIMARY KEY,
                    platform TEXT NOT NULL,
                    name TEXT NOT NULL,
                    channel_key TEXT
                );
                CREATE TABLE source_videos (
                    id INTEGER PRIMARY KEY,
                    source_id INTEGER NOT NULL,
                    platform_video_id TEXT NOT NULL,
                    url TEXT,
                    title TEXT,
                    cover_url TEXT,
                    published_at TEXT,
                    play_count INTEGER,
                    like_count INTEGER,
                    comment_count INTEGER,
                    share_count INTEGER
                );
                INSERT INTO sources (id, platform, name, channel_key)
                VALUES (1, 'bilibili', 'Nguồn thử nghiệm', '2d_animation');
                INSERT INTO source_videos (
                    id, source_id, platform_video_id, url, title, cover_url,
                    published_at, play_count, like_count, comment_count, share_count
                ) VALUES
                    (1, 1, 'one', 'https://example.test/one', 'Một', '', '2026-01-01', 1, 2, 3, 4),
                    (2, 1, 'two', 'https://example.test/two', 'Hai', '', '2026-01-02', 5, 6, 7, 8);
                """
            )
            conn.commit()
        finally:
            conn.close()

        self.connection_calls = 0
        with patch.object(library_db, "now", return_value="first-sync"):
            library_db.sync_source_videos()
        self.assertEqual(self.connection_calls, 2)

        conn = self._connection()
        try:
            rows = conn.execute(
                "SELECT platform_video_id, updated_at FROM library_videos ORDER BY platform_video_id"
            ).fetchall()
        finally:
            conn.close()
        self.assertEqual([row["platform_video_id"] for row in rows], ["one", "two"])
        self.assertEqual({row["updated_at"] for row in rows}, {"first-sync"})

        # An unchanged source scan remains read-only instead of rewriting every
        # card and growing the SQLite WAL file on each library page refresh.
        with patch.object(library_db, "now", return_value="second-sync"):
            library_db.sync_source_videos()
        conn = self._connection()
        try:
            unchanged = conn.execute(
                "SELECT updated_at FROM library_videos WHERE platform_video_id = 'one'"
            ).fetchone()
            conn.execute(
                "UPDATE source_videos SET title = 'Một bản cập nhật' WHERE platform_video_id = 'one'"
            )
            conn.commit()
        finally:
            conn.close()
        self.assertEqual(unchanged["updated_at"], "first-sync")

        with patch.object(library_db, "now", return_value="third-sync"):
            library_db.sync_source_videos()
        conn = self._connection()
        try:
            changed = conn.execute(
                "SELECT title, updated_at FROM library_videos WHERE platform_video_id = 'one'"
            ).fetchone()
        finally:
            conn.close()
        self.assertEqual(changed["title"], "Một bản cập nhật")
        self.assertEqual(changed["updated_at"], "third-sync")


if __name__ == "__main__":
    unittest.main()
